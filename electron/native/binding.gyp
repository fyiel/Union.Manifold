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
        {
          "conditions": ["OS=='win'"],
          "sources": [
            "injector.cpp",
            "shared_memory.cpp",
            "pipe_server.cpp",
            "gcpad_bridge.cpp"
          ],
          "libraries": [
            "<(PRODUCT_DIR)user32.lib",
            "<(PRODUCT_DIR)kernel32.lib",
            "<(PRODUCT_DIR)advapi32.lib",
            "<(PRODUCT_DIR)ole32.lib"
          ]
        },
        {
          "conditions": ["OS!='win'"],
          "sources": [
            "gcpad_bridge_posix.cpp"
          ],
          "libraries": [
            "-lX11",
            "-lXtst",
            "-ldl",
            "-lpthread"
          ],
          "conditions": [
            {
              "conditions": ["OS=='mac'"],
              "sources": ["stubs_nonwin.cpp"]
            }
          ]
        }
      ]
    }
  ]
}