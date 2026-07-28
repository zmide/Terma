{
  "targets": [
    {
      "target_name": "win_sftp_drag",
      "sources": [
        "src/addon.cc"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "UNICODE",
        "_UNICODE",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN",
        "_WIN32_WINNT=0x0601"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++17",
            "/EHsc"
          ],
          "ExceptionHandling": 1
        }
      },
      "libraries": [
        "ole32.lib",
        "shell32.lib",
        "user32.lib",
        "uuid.lib",
        "winhttp.lib"
      ],
      "conditions": [
        [
          "OS!='win'",
          {
            "type": "none"
          }
        ]
      ]
    }
  ]
}
