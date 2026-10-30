/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include <errno.h>
#include <poll.h>
#include <unistd.h>
#include "receiverstdin_internal.h"
#include "control/control.h"

G_STATIC_ASSERT(PLATFORM_LINUX);

int control_read_stdin(char* buffer, unsigned int size) {
    struct pollfd fd = {STDIN_FILENO, POLLIN | POLLHUP, 0};
    int result = poll(&fd, 1, 50);
    if (result == 0 || (result < 0 && errno == EINTR)) return -2;
    if (result < 0) return -1;
    ssize_t length = read(STDIN_FILENO, buffer, size);
    if (length < 0 && (errno == EINTR || errno == EAGAIN)) return -2;
    return (int)length;
}

struct ReceiverStdinPlatform {
    int cancel_pipe[2];
};

gboolean set_stdio_binary_mode(const char* mode) {
    (void)mode;
    return TRUE;
}

gboolean receiver_stdin_platform_init(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = g_new0(ReceiverStdinPlatform, 1);

    watch->platform = platform;
    platform->cancel_pipe[0] = -1;
    platform->cancel_pipe[1] = -1;

    if (pipe(platform->cancel_pipe) != 0) {
        g_printerr("Error: Could not create receiver stdin cancellation pipe: %s\n", strerror(errno));
        return FALSE;
    }

    return TRUE;
}

gpointer receiver_stdin_platform_run(gpointer data) {
    ReceiverStdinWatch* watch = (ReceiverStdinWatch*)data;
    ReceiverStdinPlatform* platform = watch->platform;

    struct pollfd descriptors[2] = {
        {STDIN_FILENO, POLLIN | POLLHUP, 0},
        {platform->cancel_pipe[0], POLLIN, 0},
    };
    unsigned char buffer[64];

    while (TRUE) {
        // Wait for stdin activity or cancellation
        int poll_result = poll(descriptors, G_N_ELEMENTS(descriptors), -1);
        if (poll_result < 0) {
            if (errno == EINTR) continue;
            receiver_stdin_watch_publish(watch, STDIN_WATCH_ERROR);
            return NULL;
        }

        // Handle stdin before cancellation when both are ready
        if (descriptors[0].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
            ssize_t bytes_read = read(STDIN_FILENO, buffer, sizeof(buffer));
            if (bytes_read > 0) continue;
            if (bytes_read == 0) {
                receiver_stdin_watch_publish(watch, STDIN_WATCH_EOF);
                return NULL;
            }

            if (errno == EINTR || errno == EAGAIN) continue;
            receiver_stdin_watch_publish(watch, STDIN_WATCH_ERROR);
            return NULL;
        }
        if (descriptors[1].revents) {
            return NULL;
        }
    }
}

gboolean receiver_stdin_platform_wait_started(ReceiverStdinWatch* watch) {
    (void)watch;
    return TRUE;
}

void receiver_stdin_platform_cancel(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = watch->platform;

    if (platform->cancel_pipe[1] >= 0) {
        const unsigned char cancel = 1;
        ssize_t ignored = write(platform->cancel_pipe[1], &cancel, sizeof(cancel));
        (void)ignored;
    }
}

void receiver_stdin_platform_clear(ReceiverStdinWatch* watch) {
    ReceiverStdinPlatform* platform = watch->platform;

    if (!platform) return;
    if (platform->cancel_pipe[0] >= 0) close(platform->cancel_pipe[0]);
    if (platform->cancel_pipe[1] >= 0) close(platform->cancel_pipe[1]);
    
    g_free(platform);
}
