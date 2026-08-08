#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {
std::mutex output_mutex;
std::atomic<bool> stopping{false};
SOCKET control_socket = INVALID_SOCKET;
constexpr uint32_t USE_EXTERNAL_HOST = 16;

void emit(const std::string& line) {
    std::lock_guard<std::mutex> lock(output_mutex);
    if (control_socket == INVALID_SOCKET) return;
    const std::string message = line + "\n";
    send(control_socket, message.data(), static_cast<int>(message.size()), 0);
}

void stop_control() {
    if (control_socket != INVALID_SOCKET) shutdown(control_socket, SD_BOTH);
}

std::string hex_encode(const char* data, size_t size) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string out(size * 2, '\0');
    for (size_t i = 0; i < size; ++i) {
        auto value = static_cast<unsigned char>(data[i]);
        out[i * 2] = digits[value >> 4];
        out[i * 2 + 1] = digits[value & 15];
    }
    return out;
}

std::string hex_encode(const std::string& value) {
    return hex_encode(value.data(), value.size());
}

bool hex_decode(const std::string& value, std::string& out) {
    if (value.size() % 2 != 0) return false;
    out.clear();
    out.reserve(value.size() / 2);
    auto digit = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < value.size(); i += 2) {
        int high = digit(value[i]);
        int low = digit(value[i + 1]);
        if (high < 0 || low < 0) return false;
        out.push_back(static_cast<char>((high << 4) | low));
    }
    return true;
}

std::wstring utf8_to_wide(const std::string& value) {
    if (value.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                   static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) return {};
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                        static_cast<int>(value.size()), out.data(), size);
    return out;
}

std::wstring windows_path(std::wstring path) {
    if (!path.empty() && path[0] == L'/') path.insert(0, L"Z:");
    std::replace(path.begin(), path.end(), L'/', L'\\');
    return path;
}

std::wstring basename(const std::wstring& path) {
    size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

std::string win32_error(const char* action) {
    DWORD code = GetLastError();
    char* message = nullptr;
    FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
                       FORMAT_MESSAGE_IGNORE_INSERTS,
                   nullptr, code, 0, reinterpret_cast<char*>(&message), 0, nullptr);
    std::ostringstream out;
    out << action << " failed (Win32 " << code << ")";
    if (message) {
        std::string text(message);
        while (!text.empty() && (text.back() == '\r' || text.back() == '\n')) text.pop_back();
        if (!text.empty()) out << ": " << text;
        LocalFree(message);
    }
    return out.str();
}

DWORD wait_for_process(const std::wstring& wanted, DWORD timeout_ms) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (!stopping && std::chrono::steady_clock::now() < deadline) {
        HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot != INVALID_HANDLE_VALUE) {
            PROCESSENTRY32W entry{};
            entry.dwSize = sizeof(entry);
            if (Process32FirstW(snapshot, &entry)) {
                do {
                    if (_wcsicmp(entry.szExeFile, wanted.c_str()) == 0) {
                        DWORD pid = entry.th32ProcessID;
                        CloseHandle(snapshot);
                        return pid;
                    }
                } while (Process32NextW(snapshot, &entry));
            }
            CloseHandle(snapshot);
        }
        Sleep(250);
    }
    return 0;
}

uintptr_t remote_module_base(DWORD pid, const std::wstring& path) {
    const std::wstring wanted = basename(path);
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;
    MODULEENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    uintptr_t result = 0;
    if (Module32FirstW(snapshot, &entry)) {
        do {
            if (_wcsicmp(entry.szModule, wanted.c_str()) == 0) {
                result = reinterpret_cast<uintptr_t>(entry.modBaseAddr);
                break;
            }
        } while (Module32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return result;
}

bool inject_library(HANDLE process, DWORD pid, const std::wstring& path, uintptr_t& remote_base) {
    const size_t bytes = (path.size() + 1) * sizeof(wchar_t);
    void* remote_path = VirtualAllocEx(process, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remote_path) return false;
    SIZE_T written = 0;
    bool ok = WriteProcessMemory(process, remote_path, path.c_str(), bytes, &written) && written == bytes;
    HANDLE thread = nullptr;
    if (ok) {
        auto load_library = reinterpret_cast<LPTHREAD_START_ROUTINE>(
            reinterpret_cast<uintptr_t>(GetProcAddress(
                GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW")));
        thread = CreateRemoteThread(process, nullptr, 0, load_library, remote_path, 0, nullptr);
        ok = thread != nullptr;
    }
    if (thread) {
        ok = WaitForSingleObject(thread, 30000) == WAIT_OBJECT_0 && ok;
        CloseHandle(thread);
    }
    VirtualFreeEx(process, remote_path, 0, MEM_RELEASE);
    if (!ok) return false;
    remote_base = remote_module_base(pid, path);
    return remote_base != 0;
}

uintptr_t export_rva(const std::wstring& path, const char* name) {
    HMODULE module = LoadLibraryExW(path.c_str(), nullptr, DONT_RESOLVE_DLL_REFERENCES);
    if (!module) return 0;
    FARPROC proc = GetProcAddress(module, name);
    uintptr_t rva = proc ? reinterpret_cast<uintptr_t>(proc) - reinterpret_cast<uintptr_t>(module) : 0;
    FreeLibrary(module);
    return rva;
}

void write_u32(std::vector<uint8_t>& buffer, size_t offset, uint32_t value) {
    std::memcpy(buffer.data() + offset, &value, sizeof(value));
}

void write_utf16(std::vector<uint8_t>& buffer, size_t offset, size_t capacity, const std::wstring& value) {
    const size_t bytes = std::min(capacity - sizeof(wchar_t), value.size() * sizeof(wchar_t));
    std::memcpy(buffer.data() + offset, value.data(), bytes);
}

bool run_trainer(HANDLE process, DWORD target_pid, uintptr_t trainerlib_base,
                 uintptr_t run_rva, const std::wstring& trainer_dll,
                 const std::wstring& message_pipe, const std::wstring& log_pipe,
                 uint32_t game_version, uint32_t flags,
                 const std::vector<std::string>& variables,
                 void*& remote_args, HANDLE& trainer_thread) {
    std::vector<uint8_t> args(1552 + variables.size() * 32, 0);
    write_utf16(args, 0, 512, log_pipe);
    write_utf16(args, 512, 256, message_pipe);
    write_u32(args, 768, flags);
    write_utf16(args, 1024, 512, trainer_dll);
    write_u32(args, 1536, target_pid);
    write_u32(args, 1540, game_version);
    write_u32(args, 1544, static_cast<uint32_t>(variables.size()));
    for (size_t i = 0; i < variables.size(); ++i) {
        std::memcpy(args.data() + 1548 + i * 32, variables[i].data(),
                    std::min<size_t>(31, variables[i].size()));
    }

    remote_args =
        VirtualAllocEx(process, nullptr, args.size(), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remote_args) return false;
    SIZE_T written = 0;
    bool ok = WriteProcessMemory(process, remote_args, args.data(), args.size(), &written) &&
              written == args.size();
    if (ok) {
        trainer_thread =
            CreateRemoteThread(process, nullptr, 0,
                               reinterpret_cast<LPTHREAD_START_ROUTINE>(trainerlib_base + run_rva),
                               remote_args, 0, nullptr);
        ok = trainer_thread != nullptr;
    }
    if (!ok) {
        VirtualFreeEx(process, remote_args, 0, MEM_RELEASE);
        remote_args = nullptr;
    }
    return ok;
}

HANDLE create_pipe(const std::wstring& name) {
    return CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX,
                            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                            1, 64 * 1024, 64 * 1024, 0, nullptr);
}

bool connect_pipe(HANDLE pipe) {
    return ConnectNamedPipe(pipe, nullptr) || GetLastError() == ERROR_PIPE_CONNECTED;
}

void message_reader(HANDLE pipe) {
    std::vector<uint8_t> pending;
    uint8_t chunk[4096];
    while (!stopping) {
        DWORD read = 0;
        if (!ReadFile(pipe, chunk, sizeof(chunk), &read, nullptr) || read == 0) break;
        pending.insert(pending.end(), chunk, chunk + read);
        size_t offset = 0;
        while (pending.size() - offset >= 8) {
            uint32_t type = 0;
            std::memcpy(&type, pending.data() + offset, 4);
            size_t size = 0;
            if (type == 0 || type == 1) size = 8;
            else if (type == 2) size = 56;
            else if (type == 3) size = 24;
            else if (type == 4) {
                if (pending.size() - offset < 48) break;
                uint32_t payload = 0;
                std::memcpy(&payload, pending.data() + offset + 40, 4);
                size = 48 + payload;
            } else {
                emit("ERROR\t" + hex_encode("Unknown TrainerLib message type"));
                stopping = true;
                break;
            }
            if (pending.size() - offset < size) break;
            const uint8_t* frame = pending.data() + offset;
            if (type == 1) {
                emit("READY");
            } else if (type == 2) {
                size_t length = 0;
                while (length < 32 && frame[16 + length] != 0) ++length;
                double value = 0;
                std::memcpy(&value, frame + 48, sizeof(value));
                std::ostringstream line;
                line << "VALUE\t" << hex_encode(reinterpret_cast<const char*>(frame + 16), length)
                     << '\t' << std::setprecision(17) << value;
                emit(line.str());
            } else if (type == 3) {
                uint32_t request = 0, result = 0;
                std::memcpy(&request, frame + 16, 4);
                std::memcpy(&result, frame + 20, 4);
            }
            offset += size;
        }
        if (offset) {
            pending.erase(
                pending.begin(),
                pending.begin() + static_cast<std::ptrdiff_t>(offset));
        }
    }
    stopping = true;
    stop_control();
}

void log_reader(HANDLE pipe) {
    if (!connect_pipe(pipe)) return;
    std::vector<uint8_t> pending;
    uint8_t chunk[4096];
    while (!stopping) {
        DWORD read = 0;
        if (!ReadFile(pipe, chunk, sizeof(chunk), &read, nullptr) || read == 0) break;
        pending.insert(pending.end(), chunk, chunk + read);
        size_t offset = 0;
        while (pending.size() - offset >= 16) {
            uint32_t length = 0;
            std::memcpy(&length, pending.data() + offset + 8, 4);
            if (pending.size() - offset < 16 + length) break;
            offset += 16 + length;
        }
        if (offset) pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(offset));
    }
}

bool handle_control(const std::string& line, HANDLE output, uint32_t& request_id) {
    if (line == "STOP") return false;
    if (line.rfind("SET\t", 0) != 0) return true;
    size_t split = line.find('\t', 4);
    if (split == std::string::npos) return true;
    std::string name;
    if (!hex_decode(line.substr(4, split - 4), name) || name.empty() || name.size() > 31) {
        return true;
    }
    double value = 0;
    try {
        value = std::stod(line.substr(split + 1));
    } catch (...) {
        return true;
    }
    uint8_t frame[56]{};
    uint32_t type = 2;
    std::memcpy(frame, &type, 4);
    std::memcpy(frame + 8, &request_id, 4);
    std::memcpy(frame + 16, name.data(), name.size());
    std::memcpy(frame + 48, &value, 8);
    DWORD written = 0;
    if (!WriteFile(output, frame, sizeof(frame), &written, nullptr) || written != sizeof(frame)) {
        emit("ERROR\t" + hex_encode(win32_error("Set trainer value")));
        return false;
    }
    ++request_id;
    return true;
}

bool connect_control(uint16_t port, const std::string& token) {
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
    control_socket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (control_socket == INVALID_SOCKET) return false;
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (connect(control_socket, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) {
        closesocket(control_socket);
        control_socket = INVALID_SOCKET;
        return false;
    }
    emit("HELLO\t" + token);
    return true;
}

struct Options {
    std::wstring target;
    std::wstring trainer;
    std::wstring trainerlib;
    uint32_t game_version = 0;
    uint32_t flags = 0;
    uint32_t timeout_ms = 120000;
    std::vector<std::string> variables;
    uint16_t connect_port = 0;
    std::string token;
};

bool parse_options(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        auto next = [&]() -> const char* { return i + 1 < argc ? argv[++i] : nullptr; };
        const char* value = nullptr;
        if (arg == "--target" && (value = next())) options.target = utf8_to_wide(value);
        else if (arg == "--trainer" && (value = next())) options.trainer = windows_path(utf8_to_wide(value));
        else if (arg == "--trainerlib" && (value = next())) options.trainerlib = windows_path(utf8_to_wide(value));
        else if (arg == "--game-version" && (value = next())) options.game_version = std::stoul(value);
        else if (arg == "--flags" && (value = next())) options.flags = std::stoul(value);
        else if (arg == "--timeout" && (value = next())) options.timeout_ms = std::stoul(value);
        else if (arg == "--connect" && (value = next())) options.connect_port = static_cast<uint16_t>(std::stoul(value));
        else if (arg == "--token" && (value = next())) options.token = value;
        else if (arg == "--variable" && (value = next())) options.variables.emplace_back(value);
        else return false;
    }
    return !options.target.empty() && !options.trainer.empty() && !options.trainerlib.empty() &&
           options.connect_port != 0 && !options.token.empty();
}
}  // namespace

int main(int argc, char** argv) {
    Options options;
    if (!parse_options(argc, argv, options) ||
        !connect_control(options.connect_port, options.token)) {
        return 2;
    }
    DWORD pid = wait_for_process(options.target, options.timeout_ms);
    if (!pid) {
        emit("ERROR\t" + hex_encode("Timed out waiting for the game process"));
        return 3;
    }

    const DWORD injection_pid =
        options.flags & USE_EXTERNAL_HOST ? GetCurrentProcessId() : pid;
    HANDLE process = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
                                     PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
                                 FALSE, injection_pid);
    if (!process) {
        emit("ERROR\t" + hex_encode(win32_error("OpenProcess")));
        return 4;
    }

    const std::wstring base = L"\\\\.\\pipe\\WeMod\\Trainer_" + std::to_wstring(GetTickCount64()) + L"_";
    const std::wstring input_name = base + L"In";
    const std::wstring output_name = base + L"Out";
    const std::wstring log_name = base + L"Log";
    HANDLE input = create_pipe(input_name);
    HANDLE output = create_pipe(output_name);
    HANDLE log = create_pipe(log_name);
    if (input == INVALID_HANDLE_VALUE || output == INVALID_HANDLE_VALUE || log == INVALID_HANDLE_VALUE) {
        emit("ERROR\t" + hex_encode(win32_error("CreateNamedPipe")));
        if (input != INVALID_HANDLE_VALUE) CloseHandle(input);
        if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
        if (log != INVALID_HANDLE_VALUE) CloseHandle(log);
        CloseHandle(process);
        return 5;
    }

    std::thread log_thread(log_reader, log);
    uintptr_t trainerlib_base = 0;
    uintptr_t run_rva = export_rva(options.trainerlib, "Run");
    void* remote_args = nullptr;
    HANDLE trainer_thread = nullptr;
    if (!run_rva ||
        !inject_library(process, injection_pid, options.trainerlib, trainerlib_base) ||
        !run_trainer(process, pid, trainerlib_base, run_rva, options.trainer, output_name,
                     log_name, options.game_version, options.flags, options.variables,
                     remote_args, trainer_thread)) {
        emit("ERROR\t" + hex_encode(win32_error("TrainerLib injection")));
        stopping = true;
        CancelIoEx(log, nullptr);
        log_thread.join();
        CloseHandle(input);
        CloseHandle(output);
        CloseHandle(log);
        CloseHandle(process);
        return 6;
    }

    if (!connect_pipe(output)) {
        emit("ERROR\t" + hex_encode(win32_error("TrainerLib output pipe")));
        stopping = true;
    } else {
        DWORD written = 0;
        WriteFile(output, input_name.data(), static_cast<DWORD>(input_name.size() * sizeof(wchar_t)),
                  &written, nullptr);
        if (!connect_pipe(input)) {
            emit("ERROR\t" + hex_encode(win32_error("TrainerLib input pipe")));
            stopping = true;
        }
    }

    std::thread message_thread;
    if (!stopping) message_thread = std::thread(message_reader, input);
    uint32_t request_id = 1;
    std::string pending;
    char control[4096];
    while (!stopping) {
        int received = recv(control_socket, control, sizeof(control), 0);
        if (received <= 0) break;
        pending.append(control, static_cast<size_t>(received));
        size_t newline = 0;
        while ((newline = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!handle_control(line, output, request_id)) {
                stopping = true;
                break;
            }
        }
    }

    stopping = true;
    CancelIoEx(input, nullptr);
    CancelIoEx(output, nullptr);
    CancelIoEx(log, nullptr);
    DisconnectNamedPipe(input);
    DisconnectNamedPipe(output);
    DisconnectNamedPipe(log);
    if (message_thread.joinable()) message_thread.join();
    if (log_thread.joinable()) log_thread.join();
    CloseHandle(input);
    CloseHandle(output);
    CloseHandle(log);
    if (trainer_thread) {
        if (WaitForSingleObject(trainer_thread, 5000) == WAIT_OBJECT_0 && remote_args) {
            VirtualFreeEx(process, remote_args, 0, MEM_RELEASE);
        }
        CloseHandle(trainer_thread);
    }
    CloseHandle(process);
    stop_control();
    if (control_socket != INVALID_SOCKET) closesocket(control_socket);
    WSACleanup();
    return 0;
}
