#include "manifest.hpp"

#include <algorithm>
#include <limits>
#include <unordered_map>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace tunneldesk::dragfs {
namespace {

using Json = nlohmann::json;

std::uint64_t read_unsigned(const Json& object, const char* key, std::uint64_t fallback = 0) {
  const auto it = object.find(key);
  if (it == object.end() || it->is_null()) {
    return fallback;
  }
  if (!it->is_number_unsigned() && !it->is_number_integer()) {
    throw ManifestError(std::string("manifest field must be an integer: ") + key);
  }
  const auto value = it->get<std::int64_t>();
  if (value < 0) {
    throw ManifestError(std::string("manifest field cannot be negative: ") + key);
  }
  return static_cast<std::uint64_t>(value);
}

std::uint64_t read_required_unsigned(const Json& object, const char* key) {
  const auto iterator = object.find(key);
  if (iterator == object.end() || iterator->is_null()) {
    throw ManifestError(std::string("manifest is missing field: ") + key);
  }
  return read_unsigned(object, key);
}

std::string read_required_string(const Json& object, const char* key) {
  const auto it = object.find(key);
  if (it == object.end() || !it->is_string()) {
    throw ManifestError(std::string("manifest field must be a string: ") + key);
  }
  return it->get<std::string>();
}

std::string parent_path(const std::string& path) {
  const auto separator = path.rfind('/');
  return separator == std::string::npos ? std::string() : path.substr(0, separator);
}

std::string base_name(const std::string& path) {
  const auto separator = path.rfind('/');
  return separator == std::string::npos ? path : path.substr(separator + 1);
}

}  // namespace

std::string validate_relative_path(std::string_view input) {
  if (input.empty() || input.size() > 4096 || input.front() == '/' || input.back() == '/') {
    throw ManifestError("manifest contains an invalid relative path");
  }
  if (input.find('\0') != std::string_view::npos) {
    throw ManifestError("manifest path contains NUL");
  }

  std::string normalized;
  normalized.reserve(input.size());
  std::size_t start = 0;
  while (start <= input.size()) {
    const auto separator = input.find('/', start);
    const auto end = separator == std::string_view::npos ? input.size() : separator;
    const auto component = input.substr(start, end - start);
    if (component.empty() || component == "." || component == ".." || component.size() > 255) {
      throw ManifestError("manifest contains an unsafe path component");
    }
    if (!normalized.empty()) {
      normalized.push_back('/');
    }
    normalized.append(component.data(), component.size());
    if (separator == std::string_view::npos) {
      break;
    }
    start = separator + 1;
  }
  return normalized;
}

Manifest parse_manifest(std::string_view json_text, std::size_t maximum_entries) {
  Json root;
  try {
    root = Json::parse(json_text.begin(), json_text.end());
  } catch (const Json::exception& error) {
    throw ManifestError(std::string("invalid manifest JSON: ") + error.what());
  }
  if (!root.is_object()) {
    throw ManifestError("manifest root must be an object");
  }
  if (root.contains("ready") && (!root["ready"].is_boolean() || !root["ready"].get<bool>())) {
    throw ManifestError("manifest is not ready");
  }
  const auto entries_it = root.find("entries");
  if (entries_it == root.end() || !entries_it->is_array()) {
    throw ManifestError("manifest entries must be an array");
  }
  if (entries_it->empty()) {
    throw ManifestError("manifest does not contain any entries");
  }
  if (entries_it->size() > maximum_entries) {
    throw ManifestError("manifest entry limit exceeded");
  }

  Manifest result;
  if (const auto it = root.find("token"); it != root.end() && it->is_string()) {
    result.token = it->get<std::string>();
  }
  result.created_at_ms = read_unsigned(root, "created_at");
  result.expires_at_ms = read_unsigned(root, "expires_at");
  result.entries.reserve(entries_it->size());

  std::unordered_set<std::size_t> indexes;
  std::unordered_set<std::string> paths;
  std::unordered_map<std::string, EntryType> types;

  for (const auto& item : *entries_it) {
    if (!item.is_object()) {
      throw ManifestError("manifest entry must be an object");
    }
    const auto index_value = read_required_unsigned(item, "index");
    if (index_value > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
      throw ManifestError("manifest entry index is too large");
    }

    ManifestEntry entry;
    entry.index = static_cast<std::size_t>(index_value);
    entry.relative_path = validate_relative_path(read_required_string(item, "relative_path"));
    entry.name = read_required_string(item, "name");
    if (entry.name.empty() || entry.name != base_name(entry.relative_path)) {
      throw ManifestError("manifest entry name does not match its relative path");
    }
    const auto type = read_required_string(item, "type");
    if (type == "file") {
      entry.type = EntryType::file;
    } else if (type == "directory") {
      entry.type = EntryType::directory;
    } else {
      throw ManifestError("manifest entry has an unsupported type");
    }
    entry.size = read_required_unsigned(item, "size");
    if (entry.size > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
      throw ManifestError("manifest entry size exceeds the Linux file size limit");
    }
    entry.modified_at_ms = read_required_unsigned(item, "modified_at");
    const auto mode = read_required_unsigned(item, "mode");
    if (mode > std::numeric_limits<std::uint32_t>::max()) {
      throw ManifestError("manifest entry mode is too large");
    }
    entry.mode = static_cast<std::uint32_t>(mode);
    const auto top_level = item.find("top_level");
    if (top_level == item.end() || !top_level->is_boolean()) {
      throw ManifestError("manifest top_level field must be boolean");
    }
    entry.top_level = top_level->get<bool>();
    if (entry.top_level && entry.relative_path.find('/') != std::string::npos) {
      throw ManifestError("nested manifest entry cannot be marked top-level");
    }
    if (!indexes.insert(entry.index).second) {
      throw ManifestError("manifest contains a duplicate entry index");
    }
    if (!paths.insert(entry.relative_path).second) {
      throw ManifestError("manifest contains a duplicate relative path");
    }
    types.emplace(entry.relative_path, entry.type);
    if (entry.top_level) {
      result.top_level_paths.push_back(entry.relative_path);
    }
    result.entries.push_back(std::move(entry));
  }

  if (result.top_level_paths.empty()) {
    throw ManifestError("manifest does not identify any top-level entries");
  }

  for (const auto& entry : result.entries) {
    const auto parent = parent_path(entry.relative_path);
    if (parent.empty()) {
      if (!entry.top_level) {
        throw ManifestError("root manifest entry must be marked top-level");
      }
      continue;
    }
    const auto parent_it = types.find(parent);
    if (parent_it == types.end()) {
      throw ManifestError("manifest is missing a parent directory entry");
    }
    if (parent_it->second != EntryType::directory) {
      throw ManifestError("manifest entry parent is not a directory");
    }
  }

  return result;
}

}  // namespace tunneldesk::dragfs
