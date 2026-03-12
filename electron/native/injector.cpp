/**
 * DLL Injector - injects/ejects the overlay DLL into a target game process.
 *
 * Uses the classic LoadLibrary + CreateRemoteThread technique.
 * This is safe for non-anti-cheat games (pirated/offline games).
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <TlHelp32.h>
#include <napi.h>
#include <string>

namespace uc_injector {

/**
 * injectDll(pid: number, dllPath: string): boolean
 *
 * Injects the DLL at dllPath into the process with the given PID.
 * Returns true on success.
 */
Napi::Value InjectDll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (pid: number, dllPath: string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD pid = info[0].As<Napi::Number>().Uint32Value();
    std::string dllPath = info[1].As<Napi::String>().Utf8Value();

    // Open target process with necessary permissions
    HANDLE hProcess = OpenProcess(
        PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION |
        PROCESS_VM_WRITE | PROCESS_VM_READ,
        FALSE, pid
    );
    if (!hProcess) {
        return Napi::Boolean::New(env, false);
    }

    // Allocate memory in target process for the DLL path
    size_t pathLen = dllPath.size() + 1;
    LPVOID remoteMem = VirtualAllocEx(hProcess, nullptr, pathLen, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remoteMem) {
        CloseHandle(hProcess);
        return Napi::Boolean::New(env, false);
    }

    // Write DLL path into remote memory
    if (!WriteProcessMemory(hProcess, remoteMem, dllPath.c_str(), pathLen, nullptr)) {
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return Napi::Boolean::New(env, false);
    }

    // Get LoadLibraryA address (same across processes on Windows)
    HMODULE hKernel32 = GetModuleHandleA("kernel32.dll");
    FARPROC pLoadLibrary = GetProcAddress(hKernel32, "LoadLibraryA");

    // Create remote thread calling LoadLibraryA with the DLL path
    HANDLE hThread = CreateRemoteThread(
        hProcess, nullptr, 0,
        (LPTHREAD_START_ROUTINE)pLoadLibrary,
        remoteMem, 0, nullptr
    );

    if (!hThread) {
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return Napi::Boolean::New(env, false);
    }

    // Wait for the remote thread to finish (with timeout)
    WaitForSingleObject(hThread, 10000);

    // Cleanup thread and remote memory
    VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
    CloseHandle(hThread);
    CloseHandle(hProcess);

    // Verify by checking if DLL appears in the process module list.
    // NOTE: GetExitCodeThread only gives the low 32 bits of the HMODULE, which is
    // unreliable on x64 (ASLR can place DLLs above 4 GB, making low bits == 0).
    std::string dllName = dllPath;
    auto lastSlash = dllName.find_last_of("\\/");
    if (lastSlash != std::string::npos) dllName = dllName.substr(lastSlash + 1);

    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (hSnap == INVALID_HANDLE_VALUE) {
        return Napi::Boolean::New(env, false);
    }

    MODULEENTRY32 me{};
    me.dwSize = sizeof(me);
    bool found = false;
    if (Module32First(hSnap, &me)) {
        do {
            if (_stricmp(me.szModule, dllName.c_str()) == 0) {
                found = true;
                break;
            }
        } while (Module32Next(hSnap, &me));
    }
    CloseHandle(hSnap);

    return Napi::Boolean::New(env, found);
}

/**
 * ejectDll(pid: number, dllPath: string): boolean
 *
 * Ejects the DLL from the target process by finding its HMODULE
 * and calling FreeLibrary via CreateRemoteThread.
 */
Napi::Value EjectDll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (pid: number, dllPath: string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD pid = info[0].As<Napi::Number>().Uint32Value();
    std::string dllPath = info[1].As<Napi::String>().Utf8Value();

    // Find the DLL's base address in the target process
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (hSnap == INVALID_HANDLE_VALUE) {
        return Napi::Boolean::New(env, false);
    }

    MODULEENTRY32 me{};
    me.dwSize = sizeof(me);
    HMODULE remoteModule = nullptr;

    // Extract just the filename from the path for comparison
    std::string dllName = dllPath;
    auto lastSlash = dllName.find_last_of("\\/");
    if (lastSlash != std::string::npos) dllName = dllName.substr(lastSlash + 1);

    if (Module32First(hSnap, &me)) {
        do {
            // Compare module name (case-insensitive)
            std::string modName(me.szModule);
            if (_stricmp(modName.c_str(), dllName.c_str()) == 0) {
                remoteModule = me.hModule;
                break;
            }
        } while (Module32Next(hSnap, &me));
    }
    CloseHandle(hSnap);

    if (!remoteModule) {
        return Napi::Boolean::New(env, false);
    }

    HANDLE hProcess = OpenProcess(
        PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION,
        FALSE, pid
    );
    if (!hProcess) {
        return Napi::Boolean::New(env, false);
    }

    HMODULE hKernel32 = GetModuleHandleA("kernel32.dll");
    FARPROC pFreeLibrary = GetProcAddress(hKernel32, "FreeLibrary");

    HANDLE hThread = CreateRemoteThread(
        hProcess, nullptr, 0,
        (LPTHREAD_START_ROUTINE)pFreeLibrary,
        remoteModule, 0, nullptr
    );

    if (!hThread) {
        CloseHandle(hProcess);
        return Napi::Boolean::New(env, false);
    }

    WaitForSingleObject(hThread, 5000);

    DWORD exitCode = 0;
    GetExitCodeThread(hThread, &exitCode);

    CloseHandle(hThread);
    CloseHandle(hProcess);

    return Napi::Boolean::New(env, exitCode != 0);
}

} // namespace uc_injector
