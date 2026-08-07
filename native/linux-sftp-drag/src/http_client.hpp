#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace terma::dragfs {

class HttpError final : public std::runtime_error {
 public:
  HttpError(std::string message, long status_code = 0);
  [[nodiscard]] long status_code() const noexcept;

 private:
  long status_code_;
};

class HttpClient {
 public:
  explicit HttpClient(std::string ticket_url);

  [[nodiscard]] std::string fetch_manifest(std::size_t maximum_bytes = 16U * 1024U * 1024U) const;
  [[nodiscard]] std::vector<std::uint8_t> read_range(
    std::size_t entry_index,
    std::uint64_t start,
    std::uint64_t end,
    const std::atomic<bool>* cancelled = nullptr
  ) const;
  void keep_alive() const;
  void release_ticket() const noexcept;

  [[nodiscard]] const std::string& ticket_url() const noexcept;
  static void validate_loopback_url(const std::string& url);

 private:
  std::string ticket_url_;
  std::string content_url(std::size_t entry_index) const;
};

}  // namespace terma::dragfs
