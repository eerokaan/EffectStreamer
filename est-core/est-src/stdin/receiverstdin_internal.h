/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#ifndef RECEIVERSTDIN_INTERNAL_H
#define RECEIVERSTDIN_INTERNAL_H

#include "receiverstdin.h"

typedef enum {
    STDIN_WATCH_NONE = 0,
    STDIN_WATCH_EOF,
    STDIN_WATCH_ERROR,
} StdinWatchResult;

typedef struct ReceiverStdinPlatform ReceiverStdinPlatform;

struct ReceiverStdinWatch {
    GMutex lock;
    gboolean cancelled;
    gboolean runtime_error;
    StdinWatchResult result;
    GThread* thread;
    GMainContext* main_context;
    GMainLoop* loop;
    GstElement* pipeline;
    GSource* source;
    ReceiverStdinPlatform* platform;
};

void receiver_stdin_watch_publish(ReceiverStdinWatch* watch, StdinWatchResult result);
gboolean receiver_stdin_watch_is_cancelled(ReceiverStdinWatch* watch);
gboolean receiver_stdin_platform_init(ReceiverStdinWatch* watch);
gpointer receiver_stdin_platform_run(gpointer data);
gboolean receiver_stdin_platform_wait_started(ReceiverStdinWatch* watch);
void receiver_stdin_platform_cancel(ReceiverStdinWatch* watch);
void receiver_stdin_platform_clear(ReceiverStdinWatch* watch);

#endif
