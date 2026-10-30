#include <stdio.h>
#include <string.h>
#include "control.h"

#define MAX_LINE (1024U * 1024U)
typedef struct { char* line; const char* error; gboolean eof; } Input;
struct CoreControl {
    GAsyncQueue* queue;
    GThread* thread;
    GSource* source;
    ControlHandler handler;
    gpointer data;
    gint stopping;
};

static void input_free(gpointer data) {
    Input* input = data;
    g_free(input->line);
    g_free(input);
}
static void send_message(CoreControl* control, cJSON* message) {
    (void)control;
    cJSON_AddNumberToObject(message, "version", 1);
    char* json = cJSON_PrintUnformatted(message);
    if (json) { fputs(json, stdout); fputc('\n', stdout); fflush(stdout); cJSON_free(json); }
    cJSON_Delete(message);
}
void control_event(CoreControl* control, const char* event, const cJSON* payload) {
    if (!control) return;
    cJSON* message = cJSON_CreateObject();
    cJSON_AddStringToObject(message, "type", "event");
    cJSON_AddStringToObject(message, "event", event);
    cJSON_AddItemToObject(message, "payload", payload ? cJSON_Duplicate(payload, TRUE) : cJSON_CreateObject());
    send_message(control, message);
}
void control_reply(CoreControl* control, const cJSON* id, const cJSON* payload, const char* code, const char* error_message) {
    cJSON* response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "type", "response");
    cJSON_AddItemToObject(response, "id", id ? cJSON_Duplicate(id, TRUE) : cJSON_CreateNull());
    cJSON_AddBoolToObject(response, "ok", code == NULL);
    if (code) {
        cJSON* error = cJSON_AddObjectToObject(response, "error");
        cJSON_AddStringToObject(error, "code", code);
        cJSON_AddStringToObject(error, "message", error_message);
    } else cJSON_AddItemToObject(response, "payload", payload ? cJSON_Duplicate(payload, TRUE) : cJSON_CreateObject());
    send_message(control, response);
}
static gpointer reader(gpointer data) {
    CoreControl* control = data;
    GString* line = g_string_sized_new(1024);
    gboolean overflow = FALSE, invalid = FALSE;
    char buffer[4096];
    while (!g_atomic_int_get(&control->stopping)) {
        if (g_async_queue_length(control->queue) >= 64) {g_usleep(1000); continue;}
        int length = control_read_stdin(buffer, sizeof(buffer));
        if (length == -2) continue;
        if (length <= 0) {
            Input* input = g_new0(Input, 1);
            input->eof = TRUE;
            if (length < 0 || line->len || overflow) input->error = "Incomplete or failed control input";
            g_async_queue_push(control->queue, input);
            break;
        }
        for (int i = 0; i < length; i++) {
            if (buffer[i] == '\n') {
                Input* input = g_new0(Input, 1);
                if (overflow || invalid) input->error = overflow ? "NDJSON request exceeds 1 MiB limit" : "NUL in NDJSON request";
                else input->line = g_strdup(line->str);
                g_async_queue_push(control->queue, input);
                g_string_truncate(line, 0); overflow = invalid = FALSE;
            } else if (line->len >= MAX_LINE) overflow = TRUE;
            else if (buffer[i] == '\0') invalid = TRUE;
            else if (!overflow) g_string_append_c(line, buffer[i]);
        }
    }
    g_string_free(line, TRUE);
    return NULL;
}
static gboolean dispatch(gpointer data) {
    CoreControl* control = data;
    for (int count = 0; count < 32; count++) {
        Input* input = g_async_queue_try_pop(control->queue);
        if (!input) break;
        if (input->error) control_reply(control, NULL, NULL, "invalidInput", input->error);
        if (input->eof) control->handler(control, NULL, control->data);
        else if (input->line) {
            cJSON* request = cJSON_ParseWithOpts(input->line, NULL, TRUE);
            if (request) control->handler(control, request, control->data);
            else control_reply(control, NULL, NULL, "invalidJson", "Request is not valid JSON");
            cJSON_Delete(request);
        }
        input_free(input);
    }
    return G_SOURCE_CONTINUE;
}
CoreControl* control_new(GMainContext* context, ControlHandler handler, gpointer data) {
    CoreControl* control = g_new0(CoreControl, 1);
    control->handler = handler; control->data = data;
    control->queue = g_async_queue_new_full(input_free);
    control->source = g_timeout_source_new(5);
    g_source_set_callback(control->source, dispatch, control, NULL);
    g_source_attach(control->source, context);
    control->thread = g_thread_new("core-control", reader, control);
    return control;
}
void control_free(CoreControl* control) {
    if (!control) return;
    g_atomic_int_set(&control->stopping, TRUE);
    g_thread_join(control->thread);
    g_source_destroy(control->source); g_source_unref(control->source);
    g_async_queue_unref(control->queue);
    g_free(control);
}
