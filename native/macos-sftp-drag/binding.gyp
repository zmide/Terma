{
  "targets": [
    {
      "target_name": "tunneldesk_macos_sftp_drag",
      "sources": [
        "src/addon.mm"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_LDFLAGS": [
                "-framework AppKit",
                "-framework UniformTypeIdentifiers"
              ]
            }
          },
          {
            "type": "none"
          }
        ]
      ]
    }
  ]
}
