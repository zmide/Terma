cmake_minimum_required(VERSION 3.20)

project(tunneldesk_linux_sftp_dragfs
  VERSION 1.0.0
  DESCRIPTION "Lazy FUSE3 bridge for TunnelDesk SFTP native drag-out"
  LANGUAGES CXX
)

include(GNUInstallDirs)
include(CTest)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FUSE3 REQUIRED IMPORTED_TARGET fuse3>=3.10)
find_package(CURL REQUIRED)
find_package(nlohmann_json 3.10 REQUIRED)
find_package(Threads REQUIRED)

add_executable(tunneldesk-linux-sftp-dragfs
  src/main.cpp
  src/dragfs.cpp
  src/http_client.cpp
  src/manifest.cpp
)

target_link_libraries(tunneldesk-linux-sftp-dragfs PRIVATE
  PkgConfig::FUSE3
  CURL::libcurl
  nlohmann_json::nlohmann_json
  Threads::Threads
)

target_compile_definitions(tunneldesk-linux-sftp-dragfs PRIVATE
  _FILE_OFFSET_BITS=64
  FUSE_USE_VERSION=31
  TUNNELDESK_DRAGFS_VERSION="${PROJECT_VERSION}"
)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(tunneldesk-linux-sftp-dragfs PRIVATE
    -Wall
    -Wextra
    -Wpedantic
    -Wconversion
    -Wshadow
    -Wformat=2
  )
endif()

install(TARGETS tunneldesk-linux-sftp-dragfs
  RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}"
)

if(BUILD_TESTING)
  add_test(
    NAME linux-sftp-dragfs-version
    COMMAND tunneldesk-linux-sftp-dragfs --version
  )
  add_test(
    NAME linux-sftp-dragfs-fuse-options
    COMMAND tunneldesk-linux-sftp-dragfs --validate-fuse-options
  )
  add_test(
    NAME linux-sftp-dragfs-manifest-fixture
    COMMAND tunneldesk-linux-sftp-dragfs
      --validate-manifest
      "${CMAKE_CURRENT_SOURCE_DIR}/tests/manifest-v1.json"
  )

  find_package(Python3 COMPONENTS Interpreter QUIET)
  if(Python3_Interpreter_FOUND)
    add_test(
      NAME linux-sftp-dragfs-cancel
      COMMAND "${Python3_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/cancel-integration.py"
        --helper "$<TARGET_FILE:tunneldesk-linux-sftp-dragfs>"
    )
    set_tests_properties(linux-sftp-dragfs-cancel PROPERTIES
      ENVIRONMENT "LC_ALL=C"
      SKIP_RETURN_CODE 77
      TIMEOUT 40
    )
  endif()
endif()
