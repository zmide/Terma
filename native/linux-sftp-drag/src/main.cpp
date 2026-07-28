#include "dragfs.hpp"
#include "http_client.hpp"
#include "manifest.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <optional>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <sys/stat.h>
#include <unistd.h>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#ifndef TUNNELDESK_DRAGFS_VERSION
#define TUNNELDESK_DRAGFS_VERSION "development"
#endif

namespace {

using Json = nlohmann::json;
using tunneldesk::dragfs::DragFileSystem;
using tunneldesk::dragfs::HttpClient;
using tunneldesk::dragfs::Manifest;
using tunneldesk::dragfs::MountOptions;

struct Arguments {
  bool help = false;
  bool version = false;
  bool probe = false;
  bool validate_fuse_options = false;
  std::optional<int> ticket_url_fd;
  std::string ticket_url;
  std::string mount_parent;
  std::string mount_point;
  std::string validate_manifest;
  std::uint64_t lease_seconds = 300;
  std::uint64_t close_grace_seconds = 30;
  std::uint64_t keep_alive_seconds = 60;
  std::size_t chunk_bytes = 4U * 1024U * 1024U;
  std::size_t maximum_entries = 20000;
};

class MountPointCleanup {
 public:
  MountPointCleanup(std::filesystem::path path, bool owned)
    : path_(std::move(path)), owned_(owned) {}

  ~MountPointCleanup() {
    if (!owned_) {
      return;
    }
    std::error_code error;
    std::filesystem::remove(path_, error);
  }

  MountPointCleanup(const MountPointCleanup&) = delete;
  MountPointCleanup& operator=(const MountPointCleanup&) = delete;

 private:
  std::filesystem::path path_;
  bool owned_;
};

std::uint64_t parse_unsigned(std::string_view value, const char* option) {
  if (value.empty() || value.front() == '-') {
    throw std::invalid_argument(std::string("invalid value for ") + option);
  }
  std::size_t consumed = 0;
  std::uint64_t parsed = 0;
  try {
    parsed = std::stoull(std::string(value), &consumed, 10);
  } catch (...) {
    throw std::invalid_argument(std::string("invalid value for ") + option);
  }
  if (consumed != value.size()) {
    throw std::invalid_argument(std::string("invalid value for ") + option);
  }
  return parsed;
}

std::string require_value(int& index, int count, char** values, const char* option) {
  if (index + 1 >= count) {
    throw std::invalid_argument(std::string("missing value for ") + option);
  }
  ++index;
  return values[index];
}

Arguments parse_arguments(int count, char** values) {
  Arguments result;
  for (int index = 1; index < count; ++index) {
    const std::string_view option(values[index]);
    if (option == "--help" || option == "-h") {
      result.help = true;
    } else if (option == "--version") {
      result.version = true;
    } else if (option == "--probe") {
      result.probe = true;
    } else if (option == "--validate-fuse-options") {
      result.validate_fuse_options = true;
    } else if (option == "--ticket-url-fd") {
      const auto raw = require_value(index, count, values, "--ticket-url-fd");
      const auto descriptor = parse_unsigned(raw, "--ticket-url-fd");
      if (descriptor > static_cast<std::uint64_t>(std::numeric_limits<int>::max())) {
        throw std::invalid_argument("ticket URL descriptor is too large");
      }
      result.ticket_url_fd = static_cast<int>(descriptor);
    } else if (option == "--ticket-url") {
      result.ticket_url = require_value(index, count, values, "--ticket-url");
    } else if (option == "--mount-parent") {
      result.mount_parent = require_value(index, count, values, "--mount-parent");
    } else if (option == "--mount-point") {
      result.mount_point = require_value(index, count, values, "--mount-point");
    } else if (option == "--lease-seconds") {
      result.lease_seconds = parse_unsigned(
        require_value(index, count, values, "--lease-seconds"),
        "--lease-seconds"
      );
    } else if (option == "--close-grace-seconds") {
      result.close_grace_seconds = parse_unsigned(
        require_value(index, count, values, "--close-grace-seconds"),
        "--close-grace-seconds"
      );
    } else if (option == "--keep-alive-seconds") {
      result.keep_alive_seconds = parse_unsigned(
        require_value(index, count, values, "--keep-alive-seconds"),
        "--keep-alive-seconds"
      );
    } else if (option == "--chunk-bytes") {
      const auto raw = parse_unsigned(
        require_value(index, count, values, "--chunk-bytes"),
        "--chunk-bytes"
      );
      if (raw > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
        throw std::invalid_argument("chunk byte count is too large");
      }
      result.chunk_bytes = static_cast<std::size_t>(raw);
    } else if (option == "--max-entries") {
      const auto raw = parse_unsigned(
        require_value(index, count, values, "--max-entries"),
        "--max-entries"
      );
      if (raw > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
        throw std::invalid_argument("entry limit is too large");
      }
      result.maximum_entries = static_cast<std::size_t>(raw);
    } else if (option == "--validate-manifest") {
      result.validate_manifest = require_value(index, count, values, "--validate-manifest");
    } else {
      throw std::invalid_argument("unknown option: " + std::string(option));
    }
  }
  if (result.lease_seconds < 5 || result.lease_seconds > 3600) {
    throw std::invalid_argument("lease duration must be between 5 and 3600 seconds");
  }
  if (result.close_grace_seconds < 1 || result.close_grace_seconds > 600) {
    throw std::invalid_argument("close grace must be between 1 and 600 seconds");
  }
  if (result.keep_alive_seconds < 5 || result.keep_alive_seconds > 600) {
    throw std::invalid_argument("keep-alive interval must be between 5 and 600 seconds");
  }
  if (result.maximum_entries == 0 || result.maximum_entries > 100000) {
    throw std::invalid_argument("entry limit must be between 1 and 100000");
  }
  return result;
}

void print_help() {
  std::cout
    << "TunnelDesk Linux SFTP dragfs\n\n"
    << "Usage:\n"
    << "  tunneldesk-linux-sftp-dragfs --ticket-url-fd 3 [options]\n"
    << "  tunneldesk-linux-sftp-dragfs --probe\n"
    << "  tunneldesk-linux-sftp-dragfs --validate-fuse-options\n"
    << "  tunneldesk-linux-sftp-dragfs --validate-manifest FILE\n\n"
    << "Options:\n"
    << "  --ticket-url-fd FD       Read the loopback ticket URL from a pipe\n"
    << "  --ticket-url URL         Debug only; exposes the ticket in process arguments\n"
    << "  --mount-parent DIR       Parent for an automatically named mount point\n"
    << "  --mount-point DIR        Use an explicit empty mount point\n"
    << "  --lease-seconds N        Idle mount lease, default 300\n"
    << "  --close-grace-seconds N  Grace after the final handle closes, default 30\n"
    << "  --keep-alive-seconds N   Backend ticket refresh interval, default 60\n"
    << "  --chunk-bytes N          Lazy HTTP read block, default 4194304\n"
    << "  --max-entries N          Manifest entry limit, default 20000\n";
}

std::string trim(std::string value) {
  const auto whitespace = [](unsigned char character) {
    return character == ' ' || character == '\t' || character == '\r' || character == '\n';
  };
  while (!value.empty() && whitespace(static_cast<unsigned char>(value.front()))) {
    value.erase(value.begin());
  }
  while (!value.empty() && whitespace(static_cast<unsigned char>(value.back()))) {
    value.pop_back();
  }
  return value;
}

std::string read_descriptor(int descriptor) {
  std::string output;
  std::array<char, 1024> buffer{};
  while (output.size() <= 8192U) {
    const auto length = read(descriptor, buffer.data(), buffer.size());
    if (length < 0) {
      if (errno == EINTR) {
        continue;
      }
      throw std::runtime_error("failed to read the drag ticket pipe");
    }
    if (length == 0) {
      break;
    }
    output.append(buffer.data(), static_cast<std::size_t>(length));
    const auto newline = output.find('\n');
    if (newline != std::string::npos) {
      output.resize(newline);
      break;
    }
  }
  if (output.size() > 8192U) {
    throw std::runtime_error("drag ticket URL exceeded 8 KiB");
  }
  output = trim(std::move(output));
  if (output.empty()) {
    throw std::runtime_error("drag ticket pipe was empty");
  }
  return output;
}

std::optional<std::filesystem::path> find_program(std::string_view name) {
  const auto* path_value = std::getenv("PATH");
  if (path_value == nullptr) {
    return std::nullopt;
  }
  std::string_view paths(path_value);
  std::size_t start = 0;
  while (start <= paths.size()) {
    const auto separator = paths.find(':', start);
    const auto end = separator == std::string_view::npos ? paths.size() : separator;
    const auto directory = paths.substr(start, end - start);
    if (!directory.empty()) {
      const auto candidate = std::filesystem::path(std::string(directory)) / name;
      struct stat details{};
      if (stat(candidate.c_str(), &details) == 0
        && S_ISREG(details.st_mode)
        && access(candidate.c_str(), X_OK) == 0) {
        return candidate;
      }
    }
    if (separator == std::string_view::npos) {
      break;
    }
    start = separator + 1;
  }
  return std::nullopt;
}

std::filesystem::path default_mount_parent() {
  if (const auto* runtime = std::getenv("XDG_RUNTIME_DIR"); runtime != nullptr && runtime[0] != '\0') {
    struct stat details{};
    if (lstat(runtime, &details) == 0
      && S_ISDIR(details.st_mode)
      && details.st_uid == geteuid()
      && access(runtime, W_OK | X_OK) == 0) {
      return std::filesystem::path(runtime) / "tunneldesk" / "sftp-drag";
    }
  }
  return std::filesystem::path("/tmp") / ("tunneldesk-" + std::to_string(geteuid())) / "sftp-drag";
}

void ensure_private_directory(const std::filesystem::path& directory) {
  std::error_code error;
  std::filesystem::create_directories(directory, error);
  if (error) {
    throw std::runtime_error("failed to create the private drag directory");
  }
  struct stat details{};
  if (lstat(directory.c_str(), &details) != 0
    || !S_ISDIR(details.st_mode)
    || S_ISLNK(details.st_mode)
    || details.st_uid != geteuid()) {
    throw std::runtime_error("drag directory is not a private directory owned by this user");
  }
  if (chmod(directory.c_str(), 0700) != 0) {
    throw std::runtime_error("failed to protect the private drag directory");
  }
}

std::string random_suffix() {
  std::random_device random;
  const auto value = (static_cast<std::uint64_t>(random()) << 32U) ^ random();
  std::ostringstream output;
  output << std::hex << std::setw(16) << std::setfill('0') << value;
  return output.str();
}

std::pair<std::filesystem::path, bool> prepare_mount_point(const Arguments& arguments) {
  if (!arguments.mount_point.empty()) {
    auto mount_point = std::filesystem::absolute(arguments.mount_point);
    std::error_code error;
    const auto existed = std::filesystem::exists(mount_point, error);
    if (error) {
      throw std::runtime_error("failed to inspect the requested mount point");
    }
    if (!existed) {
      if (!std::filesystem::create_directories(mount_point, error) || error) {
        throw std::runtime_error("failed to create the requested mount point");
      }
    }
    struct stat details{};
    if (lstat(mount_point.c_str(), &details) != 0
      || !S_ISDIR(details.st_mode)
      || S_ISLNK(details.st_mode)
      || details.st_uid != geteuid()
      || !std::filesystem::is_empty(mount_point, error)
      || error) {
      throw std::runtime_error("requested mount point must be an empty directory owned by this user");
    }
    if (chmod(mount_point.c_str(), 0700) != 0) {
      throw std::runtime_error("failed to protect the requested mount point");
    }
    return {mount_point, !existed};
  }

  auto parent = arguments.mount_parent.empty()
    ? default_mount_parent()
    : std::filesystem::absolute(arguments.mount_parent);
  ensure_private_directory(parent);
  for (int attempt = 0; attempt < 16; ++attempt) {
    const auto mount_point = parent / (
      "drag-" + std::to_string(getpid()) + "-" + random_suffix()
    );
    std::error_code error;
    if (std::filesystem::create_directory(mount_point, error)) {
      if (chmod(mount_point.c_str(), 0700) != 0) {
        std::filesystem::remove(mount_point, error);
        throw std::runtime_error("failed to protect the drag mount point");
      }
      return {mount_point, true};
    }
    if (error && error != std::errc::file_exists) {
      throw std::runtime_error("failed to create a unique drag mount point");
    }
  }
  throw std::runtime_error("failed to allocate a unique drag mount point");
}

bool file_contains(const std::filesystem::path& path, std::string_view needle) {
  std::ifstream input(path);
  if (!input) {
    return false;
  }
  std::string line;
  while (std::getline(input, line)) {
    if (line.find(needle) != std::string::npos) {
      return true;
    }
  }
  return false;
}

bool can_prepare_directory(std::filesystem::path directory) {
  std::error_code error;
  while (!directory.empty() && !std::filesystem::exists(directory, error)) {
    if (error) {
      return false;
    }
    const auto parent = directory.parent_path();
    if (parent == directory) {
      break;
    }
    directory = parent;
  }
  if (directory.empty() || error) {
    return false;
  }
  struct stat details{};
  return lstat(directory.c_str(), &details) == 0
    && S_ISDIR(details.st_mode)
    && !S_ISLNK(details.st_mode)
    && access(directory.c_str(), W_OK | X_OK) == 0;
}

int probe() {
  const bool device_exists = access("/dev/fuse", F_OK) == 0;
  const bool device_accessible = access("/dev/fuse", R_OK | W_OK) == 0;
  const auto fusermount = find_program("fusermount3");
  const auto runtime = default_mount_parent();
  const bool runtime_usable = can_prepare_directory(runtime);
  const bool kernel_fuse = file_contains("/proc/filesystems", "fuse");
  const auto* wayland = std::getenv("WAYLAND_DISPLAY");
  const auto* x11 = std::getenv("DISPLAY");
  const bool supported = device_exists
    && device_accessible
    && fusermount.has_value()
    && runtime_usable;

  Json output{
    {"event", "probe"},
    {"backend", "fuse3"},
    {"supported", supported},
    {"dev_fuse", device_exists},
    {"dev_fuse_accessible", device_accessible},
    {"kernel_fuse_listed", kernel_fuse},
    {"fusermount3", fusermount ? fusermount->string() : ""},
    {"runtime_parent", runtime.string()},
    {"runtime_parent_usable", runtime_usable},
    {"wayland", wayland != nullptr && wayland[0] != '\0'},
    {"x11", x11 != nullptr && x11[0] != '\0'},
    {"features", Json::array({"lazy-content", "multiple-items", "directories", "x11", "wayland"})}
  };
  if (!supported) {
    if (!device_exists) {
      output["reason"] = "/dev/fuse is unavailable";
    } else if (!device_accessible) {
      output["reason"] = "the current user cannot access /dev/fuse";
    } else if (!fusermount) {
      output["reason"] = "fusermount3 is unavailable";
    } else {
      output["reason"] = "the drag runtime directory cannot be prepared";
    }
  }
  std::cout << output.dump() << '\n';
  return supported ? 0 : 2;
}

std::string read_text_file(const std::filesystem::path& path, std::size_t maximum_bytes) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw std::runtime_error("failed to open the manifest fixture");
  }
  input.seekg(0, std::ios::end);
  const auto position = input.tellg();
  if (position == std::streampos(-1)) {
    throw std::runtime_error("failed to inspect the manifest fixture");
  }
  const auto length = static_cast<std::streamoff>(position);
  if (length < 0 || static_cast<std::uint64_t>(length) > maximum_bytes) {
    throw std::runtime_error("manifest fixture is too large");
  }
  input.seekg(0, std::ios::beg);
  std::string output(static_cast<std::size_t>(length), '\0');
  input.read(output.data(), static_cast<std::streamsize>(output.size()));
  if (input.gcount() != static_cast<std::streamsize>(output.size())) {
    throw std::runtime_error("failed to read the manifest fixture");
  }
  return output;
}

int validate_manifest_file(const Arguments& arguments) {
  const auto manifest = tunneldesk::dragfs::parse_manifest(
    read_text_file(arguments.validate_manifest, 16U * 1024U * 1024U),
    arguments.maximum_entries
  );
  std::uint64_t bytes = 0;
  for (const auto& entry : manifest.entries) {
    if (entry.type == tunneldesk::dragfs::EntryType::file) {
      bytes += entry.size;
    }
  }
  std::cout << Json{
    {"event", "manifest-valid"},
    {"entries", manifest.entries.size()},
    {"top_level", manifest.top_level_paths.size()},
    {"bytes", bytes}
  }.dump() << '\n';
  return 0;
}

int validate_fuse_options() {
  DragFileSystem::validate_fuse_options();
  std::cout << Json{{"event", "fuse-options-valid"}}.dump() << '\n';
  return 0;
}

int run_filesystem(const Arguments& arguments) {
  std::string ticket_url;
  if (arguments.ticket_url_fd) {
    ticket_url = read_descriptor(*arguments.ticket_url_fd);
  } else {
    ticket_url = trim(arguments.ticket_url);
  }
  if (ticket_url.empty()) {
    throw std::invalid_argument("a ticket URL pipe is required");
  }

  HttpClient http(ticket_url);
  try {
    Manifest manifest = tunneldesk::dragfs::parse_manifest(
      http.fetch_manifest(),
      arguments.maximum_entries
    );
    auto [mount_point, owned] = prepare_mount_point(arguments);
    MountPointCleanup cleanup(mount_point, owned);
    MountOptions options;
    options.lease_duration = std::chrono::seconds(arguments.lease_seconds);
    options.close_grace = std::chrono::seconds(arguments.close_grace_seconds);
    options.keep_alive_interval = std::chrono::seconds(arguments.keep_alive_seconds);
    options.chunk_bytes = arguments.chunk_bytes;
    DragFileSystem filesystem(http, std::move(manifest), mount_point.string(), options);
    return filesystem.run();
  } catch (...) {
    http.release_ticket();
    throw;
  }
}

void emit_error(const std::exception& error) noexcept {
  try {
    std::cerr << "TunnelDesk Linux SFTP dragfs: " << error.what() << '\n';
    std::cout << Json{
      {"event", "error"},
      {"message", error.what()}
    }.dump() << '\n' << std::flush;
  } catch (...) {
  }
}

}  // namespace

int main(int count, char** values) {
  try {
    const auto arguments = parse_arguments(count, values);
    if (arguments.help) {
      print_help();
      return 0;
    }
    if (arguments.version) {
      std::cout << TUNNELDESK_DRAGFS_VERSION << '\n';
      return 0;
    }
    if (arguments.probe) {
      return probe();
    }
    if (arguments.validate_fuse_options) {
      return validate_fuse_options();
    }
    if (!arguments.validate_manifest.empty()) {
      return validate_manifest_file(arguments);
    }
    return run_filesystem(arguments);
  } catch (const std::exception& error) {
    emit_error(error);
    return 1;
  }
}
