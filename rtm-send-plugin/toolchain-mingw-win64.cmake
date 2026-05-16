# CMake toolchain for cross-compiling RTM Send VST3 for Windows x64
# from macOS with the Homebrew mingw-w64 (GCC 15) toolchain.
#
# Usage:
#   cmake -S rtm-send-plugin -B rtm-send-plugin/build-win-cross \
#     -G Ninja \
#     -DCMAKE_TOOLCHAIN_FILE=rtm-send-plugin/toolchain-mingw-win64.cmake \
#     -DCMAKE_BUILD_TYPE=Release

set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR AMD64)

set(TRIPLE x86_64-w64-mingw32)

find_program(GCC_MINGW  ${TRIPLE}-gcc  REQUIRED)
find_program(GXX_MINGW  ${TRIPLE}-g++  REQUIRED)
find_program(RC_MINGW   ${TRIPLE}-windres REQUIRED)

set(CMAKE_C_COMPILER   ${GCC_MINGW})
set(CMAKE_CXX_COMPILER ${GXX_MINGW})
set(CMAKE_RC_COMPILER  ${RC_MINGW})

# Force-include standard C headers before any JUCE header.
# JUCE's renderer/core code uses memset/strlen/etc. without explicit
# includes, relying on MSVC's platform headers to pull them in
# transitively. MinGW's headers are more strict about this.
set(CMAKE_C_FLAGS_INIT
    "-include string.h -include stdlib.h -include stdio.h -include /tmp/juce_compat.h")
set(CMAKE_CXX_FLAGS_INIT
    "-include cstring -include cstdlib -include cstdio -include /tmp/juce_compat.h -fpermissive")

# Static runtime — avoids shipping libgcc_s.dll / libstdc++-6.dll with
# the plugin. JUCE itself statically links the CRT when building with
# MSVC; replicate that behaviour here.
set(CMAKE_EXE_LINKER_FLAGS_INIT    "-static -static-libgcc -static-libstdc++")
set(CMAKE_MODULE_LINKER_FLAGS_INIT "-static -static-libgcc -static-libstdc++")
set(CMAKE_SHARED_LINKER_FLAGS_INIT "-static -static-libgcc -static-libstdc++")

# Search only in the sysroot — never pick up macOS headers / libs.
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
