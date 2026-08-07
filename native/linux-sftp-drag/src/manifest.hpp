#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace terma::dragfs {

enum class EntryType {
  file,
  directory
};

struct ManifestEntry {
  std::size_t index = 0;
  std::string name;
  std::string relative_path;
  EntryType type = EntryType::file;
  std::uint64_t size = 0;
  std::uint64_t modified_at_ms = 0;
  std::uint32_t mode = 0;
  bool top_level = false;
};

struct Manifest {
  std::string token;
  std::uint64_t created_at_ms = 0;
  std::uint64_t expires_at_ms = 0;
  std::vector<ManifestEntry> entries;
  std::vector<std::string> top_level_paths;
};

class ManifestError final : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

Manifest parse_manifest(std::string_view json_text, std::size_t maximum_entries);
std::string validate_relative_path(std::string_view input);

}  // namespace terma::dragfs
