{
  "targets": [
    {
      "target_name": "uc_overlay_native",
      "sources": [
        "addon.cpp",
        "volume_control.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "injector.cpp",
            "shared_memory.cpp",
            "pipe_server.cpp",
            "gcpad_bridge.cpp"
          ],
          "libraries": [
            "-luser32.lib",
            "-lkernel32.lib",
            "-ladvapi32.lib",
            "-lole32.lib"
          ]
        }],
        ["OS!='win'", {
          "sources": [
            "stubs_nonwin.cpp"
          ]
        }]
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "RuntimeLibrary": 2
        }
      }
    }
  ]
}
