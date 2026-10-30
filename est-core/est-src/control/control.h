#ifndef EST_CONTROL_H
#define EST_CONTROL_H
#include <glib.h>
#include "cJSON.h"

typedef struct CoreControl CoreControl;
typedef void (*ControlHandler)(CoreControl*, const cJSON*, gpointer);
CoreControl* control_new(GMainContext* context, ControlHandler handler, gpointer data);
void control_free(CoreControl* control);
void control_event(CoreControl* control, const char* event, const cJSON* payload);
void control_reply(CoreControl* control, const cJSON* id, const cJSON* payload, const char* error_code, const char* error_message);
// Platform read: positive bytes, 0 EOF, -1 failure, -2 bounded timeout.
int control_read_stdin(char* buffer, unsigned int size);
#endif
