/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include <errno.h>
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include "receiverstdin_internal.h"
#include "control/control.h"

G_STATIC_ASSERT(PLATFORM_WINDOWS);

int control_read_stdin(char* buffer, unsigned int size) {
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    DWORD available = 0, length = 0;
    if (GetFileType(input) == FILE_TYPE_PIPE) {
        if (!PeekNamedPipe(input, NULL, 0, NULL, &available, NULL)) return GetLastError() == ERROR_BROKEN_PIPE ? 0 : -1;
        if (!available) {Sleep(20);return -2;}
        if (size > available) size = available;
    }
    if (!ReadFile(input, buffer, size, &length, NULL)) return GetLastError() == ERROR_BROKEN_PIPE ? 0 : -1;
    return (int)length;
}

struct ReceiverStdinPlatform {
    GCond thread_ready;
    HANDLE stdin_handle;
    HANDLE thread_handle;
    DWORD thread_start_error;
    gboolean thread_done;
};

gboolean set_stdio_binary_mode(const char* mode) {
    FILE* stream = is_sender_mode(mode) ? stdin : stdout;

    if (_setmode(_fileno(stream), _O_BINARY) == -1) {
        g_printerr("Error: Could not set %s to binary mode: %s\n", is_sender_mode(mode) ? "stdin" : "stdout", strerror(errno));
        return FALSE;
    }
    return TRUE;
}

static void finish_stdin_watch(ReceiverStdinWatch* watch) {
    g_mutex_lock(&watch->lock);
    watch->platform->thread_done = TRUE;
    g_cond_signal(&watch->platform->thread_ready);
    g_mutex_unlock(&watch->lock);
}

gboolean receiver_stdin_platform_init(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = g_new0(ReceiverStdinPlatform, 1);

    watch->platform = platform;
    g_cond_init(&platform->thread_ready);
    platform->stdin_handle = (HANDLE)_get_osfhandle(_fileno(stdin));

    if (platform->stdin_handle == INVALID_HANDLE_VALUE) {
        g_printerr("Error: Could not access receiver stdin handle.\n");
        return FALSE;
    }

    return TRUE;
}

gpointer receiver_stdin_platform_run(gpointer data) {
    ReceiverStdinWatch* watch = (ReceiverStdinWatch*)data;
    ReceiverStdinPlatform* platform = watch->platform;
    unsigned char buffer[64];
    HANDLE thread_handle = NULL;
    DWORD bytes_read;
    DWORD read_error;
    BOOL duplicated;

    // Register the thread handle for synchronous I/O cancellation
    // clang-format off
    duplicated = DuplicateHandle(
        GetCurrentProcess(),
        GetCurrentThread(),
        GetCurrentProcess(),
        &thread_handle,
        0,
        FALSE,
        DUPLICATE_SAME_ACCESS
    );
    g_mutex_lock(&watch->lock);
    // clang-format on

    if (duplicated) {
        platform->thread_handle = thread_handle;
    } else {
        platform->thread_start_error = GetLastError();

        if (platform->thread_start_error == 0) {
            platform->thread_start_error = ERROR_GEN_FAILURE;
        }
    }

    g_cond_signal(&platform->thread_ready);
    g_mutex_unlock(&watch->lock);

    if (!duplicated) {
        finish_stdin_watch(watch);
        return NULL;
    }

    // Read stdin until cancellation or EOF
    while (!receiver_stdin_watch_is_cancelled(watch)) {
        if (!ReadFile(platform->stdin_handle, buffer, sizeof(buffer), &bytes_read, NULL)) {
            read_error = GetLastError();

            if (read_error == ERROR_BROKEN_PIPE || read_error == ERROR_HANDLE_EOF) {
                receiver_stdin_watch_publish(watch, STDIN_WATCH_EOF);
                finish_stdin_watch(watch);
                return NULL;
            }
            if (!receiver_stdin_watch_is_cancelled(watch) || read_error != ERROR_OPERATION_ABORTED) {
                receiver_stdin_watch_publish(watch, STDIN_WATCH_ERROR);
            }

            finish_stdin_watch(watch);
            return NULL;
        }
        if (bytes_read == 0) {
            receiver_stdin_watch_publish(watch, STDIN_WATCH_EOF);
            finish_stdin_watch(watch);
            return NULL;
        }
    }

    finish_stdin_watch(watch);
    return NULL;
}

gboolean receiver_stdin_platform_wait_started(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = watch->platform;
    DWORD thread_start_error;

    g_mutex_lock(&watch->lock);
    while (!platform->thread_handle && platform->thread_start_error == 0 && !platform->thread_done) {
        g_cond_wait(&platform->thread_ready, &watch->lock);
    }
    thread_start_error = platform->thread_start_error;
    g_mutex_unlock(&watch->lock);

    if (thread_start_error != 0) {
        g_printerr("Error: Could not initialize receiver stdin watcher: %lu\n", (unsigned long)thread_start_error);
        return FALSE;
    }

    return TRUE;
}

void receiver_stdin_platform_cancel(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = watch->platform;
    gboolean warned = FALSE;

    g_mutex_lock(&watch->lock);
    while (!platform->thread_done) {
        g_mutex_unlock(&watch->lock);

        if (!CancelSynchronousIo(platform->thread_handle)) {
            DWORD cancel_error = GetLastError();
            if (cancel_error != ERROR_NOT_FOUND && !warned) {
                g_printerr("Warning: Could not cancel receiver stdin watcher: %lu\n", (unsigned long)cancel_error);
                warned = TRUE;
            }
        }

        g_mutex_lock(&watch->lock);
        if (!platform->thread_done) {
            g_cond_wait_until(&platform->thread_ready, &watch->lock, g_get_monotonic_time() + 10000);
        }
    }
    g_mutex_unlock(&watch->lock);
}

void receiver_stdin_platform_clear(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = watch->platform;

    if (!platform) return;
    if (platform->thread_handle) CloseHandle(platform->thread_handle);
    
    g_cond_clear(&platform->thread_ready);
    g_free(platform);
}
