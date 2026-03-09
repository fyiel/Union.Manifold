{
  "targets": [
    {
      "target_name": "uc_overlay_native",
      "sources": [
        "addon.cpp",
        "injector.cpp",
        "shared_memory.cpp",
        "pipe_server.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX"
      ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-luser32.lib",
            "-lkernel32.lib",
            "-ladvapi32.lib"
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
