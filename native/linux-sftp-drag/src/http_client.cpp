#include "http_client.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <limits>
#include <mutex>
#include <sstream>
#include <string_view>
#include <thread>
#include <utility>

#include <curl/curl.h>

namespace terma::dragfs {
namespace {

struct CurlGlobal {
  CurlGlobal() {
    const auto result = curl_global_init(CURL_GLOBAL_DEFAULT);
    if (result != CURLE_OK) {
      throw HttpError("failed to initialize libcurl");
    }
  }
};

struct ResponseBuffer {
  std::vector<std::uint8_t> bytes;
  std::size_t maximum_bytes = 0;
  bool overflow = false;
};

struct HttpResponse {
  long status = 0;
  std::vector<std::uint8_t> body;
};

int cancel_transfer(
  void* user_data,
  curl_off_t,
  curl_off_t,
  curl_off_t,
  curl_off_t
) {
  const auto* cancelled = static_cast<const std::atomic<bool>*>(user_data);
  return cancelled != nullptr && cancelled->load() ? 1 : 0;
}

void ensure_curl_initialized() {
  static CurlGlobal global;
  static_cast<void>(global);
}

std::size_t receive_body(char* data, std::size_t item_size, std::size_t item_count, void* user_data) {
  auto* target = static_cast<ResponseBuffer*>(user_data);
  if (item_size != 0 && item_count > std::numeric_limits<std::size_t>::max() / item_size) {
    target->overflow = true;
    return 0;
  }
  const auto length = item_size * item_count;
  if (length > target->maximum_bytes || target->bytes.size() > target->maximum_bytes - length) {
    target->overflow = true;
    return 0;
  }
  const auto* begin = reinterpret_cast<const std::uint8_t*>(data);
  target->bytes.insert(target->bytes.end(), begin, begin + length);
  return length;
}

std::string lower_ascii(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return value;
}

std::string curl_url_part(CURLU* url, CURLUPart part) {
  char* value = nullptr;
  const auto result = curl_url_get(url, part, &value, 0);
  if (result == CURLUE_NO_QUERY
    || result == CURLUE_NO_FRAGMENT
    || result == CURLUE_NO_USER
    || result == CURLUE_NO_PASSWORD) {
    return {};
  }
  if (result != CURLUE_OK || value == nullptr) {
    throw HttpError("invalid drag ticket URL");
  }
  std::string output(value);
  curl_free(value);
  return output;
}

HttpResponse perform_request(
  const std::string& url,
  const char* method,
  const char* byte_range,
  std::size_t maximum_bytes,
  int attempts,
  const std::atomic<bool>* cancelled = nullptr
) {
  ensure_curl_initialized();
  std::string last_error = "HTTP request failed";
  long last_status = 0;

  for (int attempt = 0; attempt < attempts; ++attempt) {
    if (cancelled != nullptr && cancelled->load()) {
      throw HttpError("local drag service request was cancelled");
    }
    CURL* easy = curl_easy_init();
    if (easy == nullptr) {
      throw HttpError("failed to create an HTTP request");
    }
    ResponseBuffer target;
    target.maximum_bytes = maximum_bytes;
    std::array<char, CURL_ERROR_SIZE> error_buffer{};
    curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Accept: application/json, application/octet-stream");
    headers = curl_slist_append(headers, "Cache-Control: no-store");

    curl_easy_setopt(easy, CURLOPT_URL, url.c_str());
    curl_easy_setopt(easy, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(easy, CURLOPT_USERAGENT, "Terma-Linux-SFTP-DragFS/1");
    curl_easy_setopt(easy, CURLOPT_WRITEFUNCTION, receive_body);
    curl_easy_setopt(easy, CURLOPT_WRITEDATA, &target);
    curl_easy_setopt(easy, CURLOPT_ERRORBUFFER, error_buffer.data());
    curl_easy_setopt(easy, CURLOPT_CONNECTTIMEOUT_MS, 10000L);
    curl_easy_setopt(easy, CURLOPT_LOW_SPEED_LIMIT, 1L);
    curl_easy_setopt(easy, CURLOPT_LOW_SPEED_TIME, 60L);
    curl_easy_setopt(easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(easy, CURLOPT_PROXY, "");
    curl_easy_setopt(easy, CURLOPT_NOPROXY, "*");
    curl_easy_setopt(easy, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(easy, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    curl_easy_setopt(easy, CURLOPT_REDIR_PROTOCOLS, 0L);
    curl_easy_setopt(easy, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    if (cancelled != nullptr) {
      curl_easy_setopt(easy, CURLOPT_NOPROGRESS, 0L);
      curl_easy_setopt(easy, CURLOPT_XFERINFOFUNCTION, cancel_transfer);
      curl_easy_setopt(easy, CURLOPT_XFERINFODATA, cancelled);
    }
    if (byte_range != nullptr) {
      curl_easy_setopt(easy, CURLOPT_RANGE, byte_range);
    }
    if (std::string_view(method) == "DELETE") {
      curl_easy_setopt(easy, CURLOPT_CUSTOMREQUEST, "DELETE");
    }

    const auto result = curl_easy_perform(easy);
    curl_easy_getinfo(easy, CURLINFO_RESPONSE_CODE, &last_status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(easy);

    if (target.overflow) {
      throw HttpError("HTTP response exceeded the configured limit", last_status);
    }
    if (cancelled != nullptr && cancelled->load()) {
      throw HttpError("local drag service request was cancelled", last_status);
    }
    if (result == CURLE_OK) {
      if (last_status >= 200 && last_status < 300) {
        return {last_status, std::move(target.bytes)};
      }
      last_error = "local drag service returned HTTP " + std::to_string(last_status);
      if (last_status < 500 || attempt + 1 >= attempts) {
        break;
      }
    } else {
      last_error = error_buffer[0] != '\0'
        ? std::string("local drag service request failed: ") + error_buffer.data()
        : std::string("local drag service request failed: ") + curl_easy_strerror(result);
    }

    if (attempt + 1 < attempts) {
      if (cancelled != nullptr && cancelled->load()) {
        throw HttpError("local drag service request was cancelled", last_status);
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100 * (attempt + 1)));
    }
  }

  throw HttpError(last_error, last_status);
}

}  // namespace

HttpError::HttpError(std::string message, long status_code)
  : std::runtime_error(std::move(message)), status_code_(status_code) {}

long HttpError::status_code() const noexcept {
  return status_code_;
}

HttpClient::HttpClient(std::string ticket_url) : ticket_url_(std::move(ticket_url)) {
  while (!ticket_url_.empty() && ticket_url_.back() == '/') {
    ticket_url_.pop_back();
  }
  validate_loopback_url(ticket_url_);
}

std::string HttpClient::fetch_manifest(std::size_t maximum_bytes) const {
  const auto response = perform_request(ticket_url_, "GET", nullptr, maximum_bytes, 3);
  return std::string(response.body.begin(), response.body.end());
}

std::vector<std::uint8_t> HttpClient::read_range(
  std::size_t entry_index,
  std::uint64_t start,
  std::uint64_t end,
  const std::atomic<bool>* cancelled
) const {
  if (end < start) {
    return {};
  }
  const auto expected = end - start + 1;
  if (expected > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
    throw HttpError("requested HTTP range is too large");
  }
  const auto range = std::to_string(start) + "-" + std::to_string(end);
  const auto response = perform_request(
    content_url(entry_index),
    "GET",
    range.c_str(),
    static_cast<std::size_t>(expected),
    3,
    cancelled
  );
  if (response.status != 206) {
    throw HttpError("local drag service ignored the required byte range", response.status);
  }
  if (response.body.size() != static_cast<std::size_t>(expected)) {
    throw HttpError("local drag service returned an incomplete byte range", response.status);
  }
  return response.body;
}

void HttpClient::keep_alive() const {
  static_cast<void>(perform_request(ticket_url_, "GET", nullptr, 16U * 1024U * 1024U, 2));
}

void HttpClient::release_ticket() const noexcept {
  try {
    static_cast<void>(perform_request(ticket_url_, "DELETE", nullptr, 64U * 1024U, 1));
  } catch (...) {
  }
}

const std::string& HttpClient::ticket_url() const noexcept {
  return ticket_url_;
}

void HttpClient::validate_loopback_url(const std::string& url) {
  ensure_curl_initialized();
  CURLU* parsed = curl_url();
  if (parsed == nullptr) {
    throw HttpError("failed to parse drag ticket URL");
  }
  const auto cleanup = [&parsed]() {
    curl_url_cleanup(parsed);
    parsed = nullptr;
  };
  if (curl_url_set(parsed, CURLUPART_URL, url.c_str(), 0) != CURLUE_OK) {
    cleanup();
    throw HttpError("invalid drag ticket URL");
  }
  try {
    const auto scheme = lower_ascii(curl_url_part(parsed, CURLUPART_SCHEME));
    auto host = lower_ascii(curl_url_part(parsed, CURLUPART_HOST));
    const auto user = curl_url_part(parsed, CURLUPART_USER);
    const auto password = curl_url_part(parsed, CURLUPART_PASSWORD);
    const auto query = curl_url_part(parsed, CURLUPART_QUERY);
    const auto fragment = curl_url_part(parsed, CURLUPART_FRAGMENT);
    if (host.size() >= 2 && host.front() == '[' && host.back() == ']') {
      host = host.substr(1, host.size() - 2);
    }
    if ((scheme != "http" && scheme != "https")
      || (host != "127.0.0.1" && host != "::1" && host != "localhost")
      || !user.empty()
      || !password.empty()
      || !query.empty()
      || !fragment.empty()) {
      throw HttpError("drag ticket URL must use a credential-free loopback HTTP origin");
    }
  } catch (...) {
    cleanup();
    throw;
  }
  cleanup();
}

std::string HttpClient::content_url(std::size_t entry_index) const {
  return ticket_url_ + "/content/" + std::to_string(entry_index);
}

}  // namespace terma::dragfs
