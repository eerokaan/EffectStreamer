/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "receiverstdin_internal.h"

static gboolean dispatch_stdin_result(gpointer data) {
    ReceiverStdinWatch* watch = (ReceiverStdinWatch*)data;
    StdinWatchResult result;

    g_mutex_lock(&watch->lock);
    if (watch->cancelled) {
        g_mutex_unlock(&watch->lock);
        return G_SOURCE_REMOVE;
    }
    result = watch->result;
    g_mutex_unlock(&watch->lock);

    if (result == STDIN_WATCH_EOF) {
        g_printerr("Receiver stdin reached EOF; requesting EOS.\n");
        if (!gst_element_send_event(watch->pipeline, gst_event_new_eos())) {
            g_printerr("Error: Could not send EOS to the receiver pipeline.\n");
            g_mutex_lock(&watch->lock);
            watch->runtime_error = TRUE;
            g_mutex_unlock(&watch->lock);
            g_main_loop_quit(watch->loop);
        }
    } else if (result == STDIN_WATCH_ERROR) {
        g_printerr("Error: Failed while watching receiver stdin.\n");
        g_mutex_lock(&watch->lock);
        watch->runtime_error = TRUE;
        g_mutex_unlock(&watch->lock);
        g_main_loop_quit(watch->loop);
    }
    return G_SOURCE_REMOVE;
}

void receiver_stdin_watch_publish(ReceiverStdinWatch* watch, StdinWatchResult result) {
    gboolean publish;

    g_mutex_lock(&watch->lock);
    publish = !watch->cancelled;
    if (publish) {
        watch->result = result;
        if (result == STDIN_WATCH_ERROR) watch->runtime_error = TRUE;
    }
    g_mutex_unlock(&watch->lock);

    if (publish) {
        g_source_set_ready_time(watch->source, 0);
        g_main_context_wakeup(watch->main_context);
    }
}

gboolean receiver_stdin_watch_is_cancelled(ReceiverStdinWatch* watch) {
    gboolean cancelled;

    g_mutex_lock(&watch->lock);
    cancelled = watch->cancelled;
    g_mutex_unlock(&watch->lock);
    
    return cancelled;
}

static void release_stdin_watch(ReceiverStdinWatch* watch) {
    if (watch->source) {
        g_source_destroy(watch->source);
        g_source_unref(watch->source);
    }

    if (watch->pipeline) gst_object_unref(watch->pipeline);
    if (watch->loop) g_main_loop_unref(watch->loop);
    if (watch->main_context) g_main_context_unref(watch->main_context);

    receiver_stdin_platform_clear(watch);
    g_mutex_clear(&watch->lock);
    g_free(watch);
}

ReceiverStdinWatch* receiver_stdin_watch_start(AppContext* context) {
    ReceiverStdinWatch* watch = g_new0(ReceiverStdinWatch, 1);

    g_mutex_init(&watch->lock);
    if (!receiver_stdin_platform_init(watch)) {
        release_stdin_watch(watch);
        return NULL;
    }

    watch->main_context = g_main_context_ref(g_main_loop_get_context(context->loop));
    watch->loop = g_main_loop_ref(context->loop);
    watch->pipeline = gst_object_ref(context->pipeline);
    watch->source = g_timeout_source_new(G_MAXUINT);

    g_source_set_callback(watch->source, dispatch_stdin_result, watch, NULL);
    g_source_attach(watch->source, watch->main_context);
    g_source_set_ready_time(watch->source, -1);
    
    watch->thread = g_thread_new("receiver-stdin", receiver_stdin_platform_run, watch);

    if (!receiver_stdin_platform_wait_started(watch)) {
        g_thread_join(watch->thread);
        watch->thread = NULL;
        release_stdin_watch(watch);
        return NULL;
    }
    return watch;
}

void receiver_stdin_watch_stop(ReceiverStdinWatch* watch) {
    g_mutex_lock(&watch->lock);
    watch->cancelled = TRUE;
    g_mutex_unlock(&watch->lock);

    receiver_stdin_platform_cancel(watch);
    if (watch->thread) g_thread_join(watch->thread);
    release_stdin_watch(watch);
}

gboolean receiver_stdin_watch_had_error(ReceiverStdinWatch* watch) {
    gboolean result;

    g_mutex_lock(&watch->lock);
    result = watch->runtime_error;
    g_mutex_unlock(&watch->lock);

    return result;
}
