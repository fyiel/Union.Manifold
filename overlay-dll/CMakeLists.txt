cmake_minimum_required(VERSION 3.20)
project(uc-overlay VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# MinHook (bundled)
add_library(minhook STATIC
  vendor/minhook/src/buffer.c
  vendor/minhook/src/hook.c
  vendor/minhook/src/trampoline.c
  vendor/minhook/src/hde/hde32.c
  vendor/minhook/src/hde/hde64.c
)
target_include_directories(minhook PUBLIC vendor/minhook/include)

# Overlay DLL
add_library(uc-overlay-x64 SHARED
  src/dllmain.cpp
  src/ipc/pipe_client.cpp
  src/memory/shared_frame.cpp
  src/hooks/d3d9_hook.cpp
  src/hooks/d3d11_hook.cpp
  src/hooks/opengl_hook.cpp
  src/hooks/wndproc_hook.cpp
  src/renderer/d3d9_renderer.cpp
  src/renderer/d3d11_renderer.cpp
  src/renderer/gl_renderer.cpp
)

target_include_directories(uc-overlay-x64 PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/vendor/minhook/include
)

target_link_libraries(uc-overlay-x64 PRIVATE
  minhook
  d3d9
  d3d11
  dxgi
  d3dcompiler
  opengl32
  user32
  kernel32
)

# Output to build/ in the project root so electron-builder can find it
set_target_properties(uc-overlay-x64 PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../build"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../build"
  ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../build"
)

# MSVC-specific flags
if(MSVC)
  target_compile_options(uc-overlay-x64 PRIVATE /W3 /WX- /MT)
  target_compile_definitions(uc-overlay-x64 PRIVATE _CRT_SECURE_NO_WARNINGS WIN32_LEAN_AND_MEAN NOMINMAX)
endif()
