#pragma once

#include "http_client.hpp"
#include "manifest.hpp"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <fuse.h>

namespace tunneldesk::dragfs {

struct MountOptions {
  std::chrono::seconds lease_duration{300};
  std::chrono::seconds close_grace{30};
  std::chrono::seconds keep_alive_interval{60};
  std::size_t chunk_bytes = 4U * 1024U * 1024U;
};

class DragFileSystem {
 public:
  DragFileSystem(
    HttpClient http,
    Manifest manifest,
    std::string mount_point,
    MountOptions options
  );
  ~DragFileSystem();

  DragFileSystem(const DragFileSystem&) = delete;
  DragFileSystem& operator=(const DragFileSystem&) = delete;

  int run();
  static void validate_fuse_options();
  [[nodiscard]] const std::vector<std::string>& exported_paths() const noexcept;

 private:
  struct VirtualNode;
  struct FileHandle;

  HttpClient http_;
  Manifest manifest_;
  std::string mount_point_;
  MountOptions options_;
  std::unique_ptr<VirtualNode> root_;
  std::unordered_map<std::string, VirtualNode*> nodes_;
  std::vector<std::string> exported_paths_;

  struct fuse* fuse_ = nullptr;
  std::atomic<bool> mounted_{false};
  bool signal_handlers_installed_ = false;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> force_exit_when_idle_{false};
  std::atomic<bool> cancel_requested_{false};
  std::atomic<bool> release_requested_{false};
  std::atomic<bool> content_accessed_{false};
  std::atomic<bool> content_complete_{false};
  std::atomic<std::uint64_t> open_references_{0};
  std::mutex progress_mutex_;
  std::size_t completed_entries_ = 0;
  std::mutex lease_mutex_;
  std::chrono::steady_clock::time_point lease_deadline_;
  std::chrono::steady_clock::time_point cancel_deadline_;
  std::mutex event_mutex_;
  std::thread watchdog_thread_;
  std::thread keep_alive_thread_;
  std::thread control_thread_;

  void build_tree();
  VirtualNode* find_node(const char* path) const noexcept;
  void touch_lease(std::chrono::seconds duration = std::chrono::seconds::zero());
  void mark_content_access();
  void mark_file_range(VirtualNode& node, std::uint64_t start, std::uint64_t length);
  void mark_directory_complete(VirtualNode& node);
  void mark_entry_complete(VirtualNode& node);
  void add_open_reference();
  void remove_open_reference();
  void request_exit(const std::string& reason);
  void emit_event(const std::string& event, const std::string& message = {}) noexcept;
  void emit_ready() noexcept;
  void watchdog_loop();
  void keep_alive_loop();
  void control_loop();
  void handle_control_line(const std::string& line);
  std::vector<std::uint8_t> read_chunk(
    VirtualNode& node,
    std::uint64_t offset,
    std::size_t maximum
  );

  static DragFileSystem* current() noexcept;
  static struct fuse* create_unmounted_fuse(void* user_data);
  static struct fuse_operations operations();
  static int on_getattr(const char* path, struct stat* stat_buffer, struct fuse_file_info* file_info);
  static int on_access(const char* path, int mask);
  static int on_open(const char* path, struct fuse_file_info* file_info);
  static int on_release(const char* path, struct fuse_file_info* file_info);
  static int on_read(
    const char* path,
    char* output,
    std::size_t size,
    off_t offset,
    struct fuse_file_info* file_info
  );
  static int on_opendir(const char* path, struct fuse_file_info* file_info);
  static int on_releasedir(const char* path, struct fuse_file_info* file_info);
  static int on_readdir(
    const char* path,
    void* output,
    fuse_fill_dir_t filler,
    off_t offset,
    struct fuse_file_info* file_info,
    enum fuse_readdir_flags flags
  );
  static int on_statfs(const char* path, struct statvfs* statistics);
};

}  // namespace tunneldesk::dragfs
