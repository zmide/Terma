#include "dragfs.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <climits>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <iterator>
#include <limits>
#include <new>
#include <poll.h>
#include <stdexcept>
#include <string_view>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>
#include <utility>

#include <nlohmann/json.hpp>

namespace tunneldesk::dragfs {
namespace {

using Json = nlohmann::json;

std::string parent_path(const std::string& path) {
  const auto separator = path.rfind('/');
  return separator == std::string::npos ? std::string() : path.substr(0, separator);
}

std::string base_name(const std::string& path) {
  const auto separator = path.rfind('/');
  return separator == std::string::npos ? path : path.substr(separator + 1);
}

std::size_t path_depth(const std::string& path) {
  return static_cast<std::size_t>(std::count(path.begin(), path.end(), '/'));
}

timespec milliseconds_to_timespec(std::uint64_t milliseconds) {
  timespec output{};
  output.tv_sec = static_cast<time_t>(milliseconds / 1000U);
  output.tv_nsec = static_cast<long>((milliseconds % 1000U) * 1000000U);
  return output;
}

std::uint64_t clamp_lease_seconds(const Json& command, std::uint64_t fallback) {
  const auto iterator = command.find("seconds");
  if (iterator == command.end() || (!iterator->is_number_integer() && !iterator->is_number_unsigned())) {
    return fallback;
  }
  const auto requested = iterator->get<std::int64_t>();
  if (requested <= 0) {
    return fallback;
  }
  return std::min<std::uint64_t>(3600U, static_cast<std::uint64_t>(requested));
}

struct fuse_args make_fuse_arguments() {
  struct fuse_args arguments = FUSE_ARGS_INIT(0, nullptr);
  if (fuse_opt_add_arg(&arguments, "tunneldesk-linux-sftp-dragfs") != 0
    || fuse_opt_add_arg(&arguments, "-o") != 0
    || fuse_opt_add_arg(
      &arguments,
      "ro,default_permissions,auto_unmount,fsname=TunnelDesk-SFTP,subtype=tunneldesk-dragfs"
    ) != 0) {
    fuse_opt_free_args(&arguments);
    throw std::runtime_error("failed to allocate FUSE arguments");
  }
  return arguments;
}

}  // namespace

struct DragFileSystem::VirtualNode {
  std::uint64_t inode = 1;
  std::string name;
  std::string relative_path;
  EntryType type = EntryType::directory;
  std::size_t entry_index = 0;
  std::uint64_t size = 0;
  std::uint64_t modified_at_ms = 0;
  std::uint32_t mode = 0;
  VirtualNode* parent = nullptr;
  std::map<std::string, std::unique_ptr<VirtualNode>, std::less<>> children;
  std::mutex cache_mutex;
  std::uint64_t cache_offset = std::numeric_limits<std::uint64_t>::max();
  std::vector<std::uint8_t> cache;
  std::atomic<std::uint32_t> open_files{0};
  bool delivery_complete = false;
  std::uint64_t delivered_bytes = 0;
  std::vector<std::pair<std::uint64_t, std::uint64_t>> delivered_ranges;
};

struct DragFileSystem::FileHandle {
  explicit FileHandle(VirtualNode* source) : node(source) {}
  VirtualNode* node;
};

DragFileSystem::DragFileSystem(
  HttpClient http,
  Manifest manifest,
  std::string mount_point,
  MountOptions options
) : http_(std::move(http)),
    manifest_(std::move(manifest)),
    mount_point_(std::move(mount_point)),
    options_(options),
    lease_deadline_(std::chrono::steady_clock::now() + options_.lease_duration),
    cancel_deadline_(std::chrono::steady_clock::time_point::max()) {
  if (options_.chunk_bytes < 64U * 1024U || options_.chunk_bytes > 64U * 1024U * 1024U) {
    throw std::invalid_argument("chunk size must be between 64 KiB and 64 MiB");
  }
  build_tree();
}

DragFileSystem::~DragFileSystem() {
  stopping_.store(true);
  if (watchdog_thread_.joinable()) {
    watchdog_thread_.join();
  }
  if (keep_alive_thread_.joinable()) {
    keep_alive_thread_.join();
  }
  if (control_thread_.joinable()) {
    control_thread_.join();
  }
  if (fuse_ != nullptr) {
    auto* session = fuse_get_session(fuse_);
    if (signal_handlers_installed_) {
      fuse_remove_signal_handlers(session);
      signal_handlers_installed_ = false;
    }
    if (mounted_.exchange(false)) {
      fuse_unmount(fuse_);
    }
    fuse_destroy(fuse_);
    fuse_ = nullptr;
    http_.release_ticket();
  }
}

void DragFileSystem::build_tree() {
  root_ = std::make_unique<VirtualNode>();
  root_->inode = 1;
  root_->name = "/";
  root_->relative_path.clear();
  root_->type = EntryType::directory;
  root_->mode = 0755;
  root_->modified_at_ms = manifest_.created_at_ms;
  nodes_.emplace(std::string(), root_.get());

  std::vector<const ManifestEntry*> ordered;
  ordered.reserve(manifest_.entries.size());
  for (const auto& entry : manifest_.entries) {
    ordered.push_back(&entry);
  }
  std::stable_sort(ordered.begin(), ordered.end(), [](const auto* left, const auto* right) {
    return path_depth(left->relative_path) < path_depth(right->relative_path);
  });

  std::uint64_t next_inode = 2;
  for (const auto* entry : ordered) {
    const auto parent = parent_path(entry->relative_path);
    const auto parent_iterator = nodes_.find(parent);
    if (parent_iterator == nodes_.end() || parent_iterator->second->type != EntryType::directory) {
      throw ManifestError("manifest tree has an unavailable parent directory");
    }

    auto node = std::make_unique<VirtualNode>();
    node->inode = next_inode++;
    node->name = base_name(entry->relative_path);
    node->relative_path = entry->relative_path;
    node->type = entry->type;
    node->entry_index = entry->index;
    node->size = entry->size;
    node->modified_at_ms = entry->modified_at_ms;
    node->mode = entry->mode;
    node->parent = parent_iterator->second;
    auto* node_pointer = node.get();
    const auto inserted = parent_iterator->second->children.emplace(node->name, std::move(node));
    if (!inserted.second) {
      throw ManifestError("manifest tree contains a duplicate child name");
    }
    nodes_.emplace(entry->relative_path, node_pointer);
  }

  exported_paths_.reserve(manifest_.top_level_paths.size());
  for (const auto& relative_path : manifest_.top_level_paths) {
    if (nodes_.find(relative_path) == nodes_.end()) {
      throw ManifestError("manifest top-level path is unavailable");
    }
    exported_paths_.push_back(mount_point_ + "/" + relative_path);
  }
}

const std::vector<std::string>& DragFileSystem::exported_paths() const noexcept {
  return exported_paths_;
}

DragFileSystem::VirtualNode* DragFileSystem::find_node(const char* path) const noexcept {
  if (path == nullptr || path[0] != '/') {
    return nullptr;
  }
  if (path[1] == '\0') {
    return root_.get();
  }
  VirtualNode* current_node = root_.get();
  std::string_view remaining(path + 1);
  while (!remaining.empty()) {
    const auto separator = remaining.find('/');
    const auto component = remaining.substr(0, separator);
    if (component.empty()) {
      if (separator == std::string_view::npos || separator + 1 == remaining.size()) {
        return current_node;
      }
      return nullptr;
    }
    const auto child = current_node->children.find(component);
    if (child == current_node->children.end()) {
      return nullptr;
    }
    current_node = child->second.get();
    if (separator == std::string_view::npos) {
      return current_node;
    }
    remaining.remove_prefix(separator + 1);
  }
  return current_node;
}

void DragFileSystem::touch_lease(std::chrono::seconds duration) {
  if (force_exit_when_idle_.load()) {
    return;
  }
  const auto completed_release = release_requested_.load() && content_complete_.load();
  if (duration <= std::chrono::seconds::zero()) {
    if (release_requested_.load()) {
      duration = completed_release
        ? std::min(options_.close_grace, std::chrono::seconds(5))
        : options_.close_grace;
    } else {
      duration = options_.lease_duration;
    }
  }
  const auto next_deadline = std::chrono::steady_clock::now() + duration;
  std::lock_guard lock(lease_mutex_);
  // File managers may continue polling getattr/access after they have copied
  // every byte. Once the drag has been released and delivery is complete,
  // those bookkeeping calls must not keep extending the FUSE mount forever.
  lease_deadline_ = completed_release
    ? std::min(lease_deadline_, next_deadline)
    : next_deadline;
}

void DragFileSystem::add_open_reference() {
  open_references_.fetch_add(1);
  touch_lease();
}

void DragFileSystem::mark_content_access() {
  if (!content_accessed_.exchange(true)) {
    emit_event("consuming");
  }
  touch_lease();
}

void DragFileSystem::mark_entry_complete(VirtualNode& node) {
  bool completed = false;
  {
    std::lock_guard lock(progress_mutex_);
    if (node.delivery_complete) return;
    node.delivery_complete = true;
    completed_entries_ += 1;
    if (completed_entries_ == manifest_.entries.size()) {
      content_complete_.store(true);
      completed = true;
    }
  }
  if (completed) {
    if (release_requested_.load()) {
      touch_lease(std::min(options_.close_grace, std::chrono::seconds(5)));
    }
    emit_event("content-complete");
  }
}

void DragFileSystem::mark_file_range(
  VirtualNode& node,
  std::uint64_t start,
  std::uint64_t length
) {
  if (length == 0) return;
  bool completed = false;
  {
    std::lock_guard lock(progress_mutex_);
    if (node.delivery_complete) return;
    std::uint64_t next_start = start;
    std::uint64_t next_end = start + length - 1;
    std::vector<std::pair<std::uint64_t, std::uint64_t>> merged;
    merged.reserve(node.delivered_ranges.size() + 1);
    bool inserted = false;
    for (const auto& range : node.delivered_ranges) {
      if (range.second + 1 < next_start) {
        merged.push_back(range);
        continue;
      }
      if (next_end + 1 < range.first) {
        if (!inserted) {
          merged.emplace_back(next_start, next_end);
          inserted = true;
        }
        merged.push_back(range);
        continue;
      }
      next_start = std::min(next_start, range.first);
      next_end = std::max(next_end, range.second);
    }
    if (!inserted) merged.emplace_back(next_start, next_end);
    node.delivered_ranges = std::move(merged);
    node.delivered_bytes = 0;
    for (const auto& range : node.delivered_ranges) {
      node.delivered_bytes += range.second - range.first + 1;
    }
    if (node.delivered_bytes >= node.size) {
      node.delivery_complete = true;
      completed_entries_ += 1;
      if (completed_entries_ == manifest_.entries.size()) {
        content_complete_.store(true);
        completed = true;
      }
    }
  }
  if (completed) {
    if (release_requested_.load()) {
      touch_lease(std::min(options_.close_grace, std::chrono::seconds(5)));
    }
    emit_event("content-complete");
  }
}

void DragFileSystem::mark_directory_complete(VirtualNode& node) {
  mark_entry_complete(node);
}

void DragFileSystem::remove_open_reference() {
  const auto previous = open_references_.fetch_sub(1);
  if (previous == 0) {
    open_references_.store(0);
    return;
  }
  if (previous == 1) {
    const auto grace = release_requested_.load() && content_complete_.load()
      ? std::min(options_.close_grace, std::chrono::seconds(5))
      : options_.close_grace;
    touch_lease(grace);
  }
}

void DragFileSystem::request_exit(const std::string& reason) {
  if (stopping_.exchange(true)) {
    return;
  }
  emit_event("closing", reason);
  if (fuse_ != nullptr) {
    fuse_exit(fuse_);
    // Explicit session exit does not necessarily wake every worker blocked in
    // fuse_loop_mt(). Once cancellation has no open handles (or its bounded
    // fallback expires), close the kernel channel so all workers can join.
    if (mounted_.exchange(false)) {
      fuse_unmount(fuse_);
    }
  }
}

void DragFileSystem::emit_event(const std::string& event, const std::string& message) noexcept {
  try {
    Json payload{{"event", event}};
    if (!message.empty()) {
      payload["message"] = message;
    }
    std::lock_guard lock(event_mutex_);
    std::cout << payload.dump() << '\n' << std::flush;
  } catch (...) {
  }
}

void DragFileSystem::emit_ready() noexcept {
  try {
    Json payload{
      {"event", "ready"},
      {"backend", "fuse3"},
      {"mount_point", mount_point_},
      {"paths", exported_paths_},
      {"lease_seconds", options_.lease_duration.count()},
      {"features", Json::array({"lazy-content", "multiple-items", "directories", "x11", "wayland"})}
    };
    std::lock_guard lock(event_mutex_);
    std::cout << payload.dump() << '\n' << std::flush;
  } catch (...) {
  }
}

void DragFileSystem::watchdog_loop() {
  while (!stopping_.load()) {
    bool expired = false;
    bool cancel_expired = false;
    {
      std::lock_guard lock(lease_mutex_);
      const auto now = std::chrono::steady_clock::now();
      expired = now >= lease_deadline_;
      cancel_expired = now >= cancel_deadline_;
    }
    const auto cancelled = cancel_requested_.load();
    const auto open_references = open_references_.load();
    if (cancelled) {
      if (open_references == 0 || cancel_expired) {
        request_exit(cancel_expired && open_references > 0 ? "cancel-timeout" : "cancelled");
        return;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
      continue;
    }
    const auto forced = force_exit_when_idle_.load();
    const auto completed_release = release_requested_.load() && content_complete_.load() && expired;
    const auto abandoned_release = release_requested_.load() && !content_complete_.load() && expired;
    if (forced || completed_release || abandoned_release || (open_references == 0 && expired)) {
      request_exit(
        forced
          ? "cancelled"
          : completed_release
            ? "content-complete"
            : abandoned_release
              ? "release-idle-timeout"
              : "lease-expired"
      );
      return;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
  }
}

void DragFileSystem::keep_alive_loop() {
  auto remaining = options_.keep_alive_interval;
  while (!stopping_.load()) {
    const auto step = std::min<std::chrono::seconds>(remaining, std::chrono::seconds(1));
    std::this_thread::sleep_for(step);
    if (stopping_.load()) {
      break;
    }
    remaining -= step;
    if (remaining > std::chrono::seconds::zero()) {
      continue;
    }
    remaining = options_.keep_alive_interval;
    try {
      http_.keep_alive();
    } catch (const std::exception& error) {
      emit_event("lease-warning", error.what());
    }
  }
}

void DragFileSystem::control_loop() {
  std::string input;
  std::array<char, 2048> buffer{};
  while (!stopping_.load()) {
    pollfd descriptor{};
    descriptor.fd = STDIN_FILENO;
    descriptor.events = POLLIN | POLLHUP;
    const auto poll_result = poll(&descriptor, 1, 500);
    if (poll_result < 0) {
      if (errno == EINTR) {
        continue;
      }
      return;
    }
    if (poll_result == 0) {
      continue;
    }
    if ((descriptor.revents & POLLIN) != 0) {
      const auto count = read(STDIN_FILENO, buffer.data(), buffer.size());
      if (count <= 0) {
        force_exit_when_idle_.store(true);
        request_exit("control-closed");
        return;
      }
      input.append(buffer.data(), static_cast<std::size_t>(count));
      std::size_t newline = 0;
      while ((newline = input.find('\n')) != std::string::npos) {
        auto line = input.substr(0, newline);
        input.erase(0, newline + 1);
        if (!line.empty() && line.back() == '\r') {
          line.pop_back();
        }
        if (!line.empty()) {
          handle_control_line(line);
        }
      }
      if (input.size() > 64U * 1024U) {
        emit_event("control-error", "control message exceeded 64 KiB");
        input.clear();
      }
    }
    if ((descriptor.revents & POLLHUP) != 0 && (descriptor.revents & POLLIN) == 0) {
      force_exit_when_idle_.store(true);
      request_exit("control-closed");
      return;
    }
  }
}

void DragFileSystem::handle_control_line(const std::string& line) {
  try {
    const auto command = Json::parse(line);
    if (!command.is_object() || !command.contains("command") || !command["command"].is_string()) {
      throw std::runtime_error("control message must contain a command");
    }
    const auto name = command["command"].get<std::string>();
    if (name == "renew") {
      const auto seconds = clamp_lease_seconds(
        command,
        static_cast<std::uint64_t>(options_.lease_duration.count())
      );
      touch_lease(std::chrono::seconds(seconds));
      emit_event("renewed");
    } else if (name == "release") {
      // The desktop drag loop has ended, but a file manager may queue the
      // actual copy and open the promised paths a little later.
      release_requested_.store(true);
      const auto grace = content_complete_.load()
        ? std::min(options_.close_grace, std::chrono::seconds(5))
        : options_.close_grace;
      touch_lease(grace);
      emit_event("released");
    } else if (name == "cancel") {
      if (!cancel_requested_.exchange(true)) {
        {
          std::lock_guard lock(lease_mutex_);
          cancel_deadline_ = std::chrono::steady_clock::now() + options_.close_grace;
        }
        emit_event("cancelled");
      }
    } else if (name == "shutdown") {
      force_exit_when_idle_.store(true);
      request_exit(name);
    } else {
      throw std::runtime_error("unsupported control command");
    }
  } catch (const std::exception& error) {
    emit_event("control-error", error.what());
  }
}

std::vector<std::uint8_t> DragFileSystem::read_chunk(
  VirtualNode& node,
  std::uint64_t offset,
  std::size_t maximum
) {
  if (offset >= node.size || maximum == 0) {
    return {};
  }
  const auto length = std::min<std::uint64_t>({
    node.size - offset,
    static_cast<std::uint64_t>(maximum),
    static_cast<std::uint64_t>(options_.chunk_bytes)
  });
  return http_.read_range(
    node.entry_index,
    offset,
    offset + length - 1,
    &cancel_requested_
  );
}

DragFileSystem* DragFileSystem::current() noexcept {
  const auto* context = fuse_get_context();
  return context == nullptr ? nullptr : static_cast<DragFileSystem*>(context->private_data);
}

struct fuse_operations DragFileSystem::operations() {
  struct fuse_operations result{};
  result.getattr = on_getattr;
  result.access = on_access;
  result.open = on_open;
  result.release = on_release;
  result.read = on_read;
  result.opendir = on_opendir;
  result.releasedir = on_releasedir;
  result.readdir = on_readdir;
  result.statfs = on_statfs;
  return result;
}

int DragFileSystem::on_getattr(
  const char* path,
  struct stat* stat_buffer,
  struct fuse_file_info*
) {
  auto* state = current();
  if (state == nullptr) {
    return -EIO;
  }
  auto* node = state->find_node(path);
  if (node == nullptr) {
    return -ENOENT;
  }
  state->touch_lease();
  std::memset(stat_buffer, 0, sizeof(*stat_buffer));
  stat_buffer->st_ino = static_cast<ino_t>(node->inode);
  stat_buffer->st_uid = getuid();
  stat_buffer->st_gid = getgid();
  const auto permissions = static_cast<mode_t>(node->mode & 0777U);
  if (node->type == EntryType::directory) {
    stat_buffer->st_mode = S_IFDIR | permissions | 0500;
    stat_buffer->st_nlink = static_cast<nlink_t>(2U + std::count_if(
      node->children.begin(),
      node->children.end(),
      [](const auto& item) { return item.second->type == EntryType::directory; }
    ));
  } else {
    stat_buffer->st_mode = S_IFREG | permissions | 0400;
    stat_buffer->st_nlink = 1;
    stat_buffer->st_size = static_cast<off_t>(node->size);
    stat_buffer->st_blocks = static_cast<blkcnt_t>((node->size + 511U) / 512U);
  }
  stat_buffer->st_blksize = 4096;
  const auto modified = milliseconds_to_timespec(node->modified_at_ms);
  stat_buffer->st_atim = modified;
  stat_buffer->st_mtim = modified;
  stat_buffer->st_ctim = modified;
  return 0;
}

int DragFileSystem::on_access(const char* path, int mask) {
  auto* state = current();
  if (state == nullptr) {
    return -EIO;
  }
  auto* node = state->find_node(path);
  if (node == nullptr) {
    return -ENOENT;
  }
  state->touch_lease();
  if ((mask & W_OK) != 0) {
    return -EROFS;
  }
  if ((mask & X_OK) != 0
    && node->type != EntryType::directory
    && (node->mode & 0111U) == 0) {
    return -EACCES;
  }
  return 0;
}

int DragFileSystem::on_open(const char* path, struct fuse_file_info* file_info) {
  auto* state = current();
  if (state == nullptr) {
    return -EIO;
  }
  if (state->cancel_requested_.load()) {
    return -ECANCELED;
  }
  auto* node = state->find_node(path);
  if (node == nullptr) {
    return -ENOENT;
  }
  if (node->type != EntryType::file) {
    return -EISDIR;
  }
  if ((file_info->flags & O_ACCMODE) != O_RDONLY) {
    return -EROFS;
  }
  auto* handle = new (std::nothrow) FileHandle(node);
  if (handle == nullptr) {
    return -ENOMEM;
  }
  state->mark_content_access();
  if (node->size == 0) state->mark_entry_complete(*node);
  node->open_files.fetch_add(1);
  state->add_open_reference();
  file_info->fh = reinterpret_cast<std::uint64_t>(handle);
  file_info->keep_cache = 0;
  return 0;
}

int DragFileSystem::on_release(const char*, struct fuse_file_info* file_info) {
  auto* state = current();
  auto* handle = reinterpret_cast<FileHandle*>(file_info->fh);
  if (handle != nullptr) {
    auto* node = handle->node;
    delete handle;
    file_info->fh = 0;
    if (node != nullptr && node->open_files.fetch_sub(1) == 1) {
      std::lock_guard lock(node->cache_mutex);
      std::vector<std::uint8_t>().swap(node->cache);
      node->cache_offset = std::numeric_limits<std::uint64_t>::max();
    }
  }
  if (state != nullptr) {
    state->remove_open_reference();
  }
  return 0;
}

int DragFileSystem::on_read(
  const char* path,
  char* output,
  std::size_t size,
  off_t offset,
  struct fuse_file_info* file_info
) {
  auto* state = current();
  if (state == nullptr || offset < 0) {
    return -EIO;
  }
  auto* handle = reinterpret_cast<FileHandle*>(file_info->fh);
  auto* node = handle == nullptr ? state->find_node(path) : handle->node;
  if (node == nullptr) {
    return -ENOENT;
  }
  if (node->type != EntryType::file) {
    return -EISDIR;
  }
  const auto unsigned_offset = static_cast<std::uint64_t>(offset);
  if (unsigned_offset >= node->size || size == 0) {
    return 0;
  }
  const auto maximum = std::min<std::uint64_t>(
    static_cast<std::uint64_t>(size),
    node->size - unsigned_offset
  );
  const auto requested = static_cast<std::size_t>(
    std::min<std::uint64_t>(maximum, static_cast<std::uint64_t>(INT_MAX))
  );

  if (state->cancel_requested_.load()) {
    return -ECANCELED;
  }
  state->touch_lease();
  std::size_t copied = 0;
  try {
    std::unique_lock lock(node->cache_mutex);
    while (copied < requested) {
      if (state->cancel_requested_.load()) {
        return -ECANCELED;
      }
      const auto position = unsigned_offset + copied;
      const auto cache_end = node->cache_offset == std::numeric_limits<std::uint64_t>::max()
        ? 0
        : node->cache_offset + node->cache.size();
      if (node->cache.empty() || position < node->cache_offset || position >= cache_end) {
        node->cache = state->read_chunk(*node, position, requested - copied);
        node->cache_offset = position;
        if (state->cancel_requested_.load()) {
          return -ECANCELED;
        }
      }
      if (node->cache.empty() || position < node->cache_offset) {
        throw HttpError("local drag service returned no data");
      }
      const auto inside = static_cast<std::size_t>(position - node->cache_offset);
      if (inside >= node->cache.size()) {
        throw HttpError("local drag service returned an invalid range");
      }
      const auto available = node->cache.size() - inside;
      const auto length = std::min(available, requested - copied);
      std::memcpy(output + copied, node->cache.data() + inside, length);
      copied += length;
    }
  } catch (const std::exception& error) {
    if (state->cancel_requested_.load()) {
      return -ECANCELED;
    }
    state->emit_event("read-error", error.what());
    return -EIO;
  }
  if (state->cancel_requested_.load()) {
    return -ECANCELED;
  }
  state->mark_file_range(*node, unsigned_offset, copied);
  return static_cast<int>(copied);
}

int DragFileSystem::on_opendir(const char* path, struct fuse_file_info* file_info) {
  auto* state = current();
  if (state == nullptr) {
    return -EIO;
  }
  if (state->cancel_requested_.load()) {
    return -ECANCELED;
  }
  auto* node = state->find_node(path);
  if (node == nullptr) {
    return -ENOENT;
  }
  if (node->type != EntryType::directory) {
    return -ENOTDIR;
  }
  state->mark_content_access();
  state->add_open_reference();
  file_info->fh = reinterpret_cast<std::uint64_t>(node);
  return 0;
}

int DragFileSystem::on_releasedir(const char*, struct fuse_file_info* file_info) {
  auto* state = current();
  file_info->fh = 0;
  if (state != nullptr) {
    state->remove_open_reference();
  }
  return 0;
}

int DragFileSystem::on_readdir(
  const char* path,
  void* output,
  fuse_fill_dir_t filler,
  off_t offset,
  struct fuse_file_info* file_info,
  enum fuse_readdir_flags
) {
  auto* state = current();
  if (state == nullptr || offset < 0) {
    return -EIO;
  }
  if (state->cancel_requested_.load()) {
    return -ECANCELED;
  }
  auto* node = file_info != nullptr && file_info->fh != 0
    ? reinterpret_cast<VirtualNode*>(file_info->fh)
    : state->find_node(path);
  if (node == nullptr) {
    return -ENOENT;
  }
  if (node->type != EntryType::directory) {
    return -ENOTDIR;
  }
  state->touch_lease();
  const auto fill_flags = static_cast<fuse_fill_dir_flags>(0);

  std::size_t index = static_cast<std::size_t>(offset);
  if (index == 0) {
    if (filler(output, ".", nullptr, 1, fill_flags) != 0) {
      return 0;
    }
    index = 1;
  }
  if (index == 1) {
    if (filler(output, "..", nullptr, 2, fill_flags) != 0) {
      return 0;
    }
    index = 2;
  }

  auto iterator = node->children.begin();
  const auto child_offset = index - 2;
  if (child_offset > node->children.size()) {
    return 0;
  }
  std::advance(iterator, static_cast<std::ptrdiff_t>(child_offset));
  for (; iterator != node->children.end(); ++iterator, ++index) {
    struct stat child_stat{};
    child_stat.st_ino = static_cast<ino_t>(iterator->second->inode);
    child_stat.st_mode = iterator->second->type == EntryType::directory ? S_IFDIR : S_IFREG;
    if (filler(
      output,
      iterator->first.c_str(),
      &child_stat,
      static_cast<off_t>(index + 1),
      fill_flags
    ) != 0) {
      break;
    }
  }
  if (node != state->root_.get() && iterator == node->children.end()) {
    state->mark_directory_complete(*node);
  }
  return 0;
}

int DragFileSystem::on_statfs(const char*, struct statvfs* statistics) {
  auto* state = current();
  if (state == nullptr) {
    return -EIO;
  }
  std::memset(statistics, 0, sizeof(*statistics));
  std::uint64_t bytes = 0;
  for (const auto& entry : state->manifest_.entries) {
    if (entry.type == EntryType::file) {
      bytes = entry.size > std::numeric_limits<std::uint64_t>::max() - bytes
        ? std::numeric_limits<std::uint64_t>::max()
        : bytes + entry.size;
    }
  }
  statistics->f_bsize = 4096;
  statistics->f_frsize = 4096;
  statistics->f_blocks = static_cast<fsblkcnt_t>(
    bytes / 4096U + (bytes % 4096U == 0 ? 0U : 1U)
  );
  statistics->f_bfree = 0;
  statistics->f_bavail = 0;
  statistics->f_files = static_cast<fsfilcnt_t>(state->manifest_.entries.size() + 1U);
  statistics->f_ffree = 0;
  statistics->f_namemax = 255;
  return 0;
}

struct fuse* DragFileSystem::create_unmounted_fuse(void* user_data) {
  auto operation_table = operations();
  auto arguments = make_fuse_arguments();
  auto* result = fuse_new(&arguments, &operation_table, sizeof(operation_table), user_data);
  fuse_opt_free_args(&arguments);
  return result;
}

void DragFileSystem::validate_fuse_options() {
  auto* candidate = create_unmounted_fuse(nullptr);
  if (candidate == nullptr) {
    throw std::runtime_error("failed to create the FUSE filesystem");
  }
  fuse_destroy(candidate);
}

int DragFileSystem::run() {
  fuse_ = create_unmounted_fuse(this);
  if (fuse_ == nullptr) {
    throw std::runtime_error("failed to create the FUSE filesystem");
  }
  if (fuse_mount(fuse_, mount_point_.c_str()) != 0) {
    fuse_destroy(fuse_);
    fuse_ = nullptr;
    throw std::runtime_error("failed to mount the FUSE filesystem");
  }
  mounted_.store(true);
  auto* session = fuse_get_session(fuse_);
  if (fuse_set_signal_handlers(session) != 0) {
    if (mounted_.exchange(false)) {
      fuse_unmount(fuse_);
    }
    fuse_destroy(fuse_);
    fuse_ = nullptr;
    throw std::runtime_error("failed to install FUSE signal handlers");
  }
  signal_handlers_installed_ = true;

  watchdog_thread_ = std::thread(&DragFileSystem::watchdog_loop, this);
  keep_alive_thread_ = std::thread(&DragFileSystem::keep_alive_loop, this);
  control_thread_ = std::thread(&DragFileSystem::control_loop, this);
  emit_ready();

  const auto result = fuse_loop_mt(fuse_, 0);
  stopping_.store(true);
  if (watchdog_thread_.joinable()) {
    watchdog_thread_.join();
  }
  if (keep_alive_thread_.joinable()) {
    keep_alive_thread_.join();
  }
  if (control_thread_.joinable()) {
    control_thread_.join();
  }

  fuse_remove_signal_handlers(session);
  signal_handlers_installed_ = false;
  if (mounted_.exchange(false)) {
    fuse_unmount(fuse_);
  }
  fuse_destroy(fuse_);
  fuse_ = nullptr;
  http_.release_ticket();
  emit_event("closed");
  return result == 0 ? 0 : 1;
}

}  // namespace tunneldesk::dragfs
