/*
 * EffectStreamer NetSim
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "estnetsim.h"

GST_DEBUG_CATEGORY_STATIC(gst_est_net_sim_debug);
#define GST_CAT_DEFAULT gst_est_net_sim_debug

#define DEFAULT_PACKETLOSS_TYPE GST_EST_NET_SIM_PACKETLOSS_NONE
#define DEFAULT_PACKETLOSS_RATIO 0.0
#define DEFAULT_PACKETLOSS_SEED 0
#define DEFAULT_PACKETLOSS_BURST_MODEL GST_EST_NET_SIM_BURST_MODEL_G107_MARKOV
#define DEFAULT_PACKETLOSS_BURST_RATIO 1.0

enum {
    PROP_0,
    PROP_PACKETLOSS_TYPE,
    PROP_PACKETLOSS_RATIO,
    PROP_PACKETLOSS_SEED,
    PROP_PACKETLOSS_BURST_MODEL,
    PROP_PACKETLOSS_BURST_RATIO,
};

static GstStaticPadTemplate sink_template = GST_STATIC_PAD_TEMPLATE(
    "sink", GST_PAD_SINK, GST_PAD_ALWAYS, GST_STATIC_CAPS("ANY"));

static GstStaticPadTemplate src_template = GST_STATIC_PAD_TEMPLATE(
    "src", GST_PAD_SRC, GST_PAD_ALWAYS, GST_STATIC_CAPS("ANY"));

#define gst_est_net_sim_parent_class parent_class
G_DEFINE_TYPE(GstEstNetSim, gst_est_net_sim, GST_TYPE_ELEMENT);

static GType gst_est_net_sim_packetloss_type_get_type(void);
static GType gst_est_net_sim_burst_model_get_type(void);

#define GST_TYPE_EST_NET_SIM_PACKETLOSS_TYPE \
    (gst_est_net_sim_packetloss_type_get_type())
#define GST_TYPE_EST_NET_SIM_BURST_MODEL \
    (gst_est_net_sim_burst_model_get_type())

static void gst_est_net_sim_set_property(GObject* object, guint prop_id,
                                         const GValue* value,
                                         GParamSpec* pspec);
static void gst_est_net_sim_get_property(GObject* object, guint prop_id,
                                         GValue* value, GParamSpec* pspec);
static void gst_est_net_sim_finalize(GObject* object);
static GstStateChangeReturn gst_est_net_sim_change_state(
    GstElement* element, GstStateChange transition);
static gboolean gst_est_net_sim_sink_event(GstPad* pad, GstObject* parent,
                                           GstEvent* event);
static GstFlowReturn gst_est_net_sim_chain(GstPad* pad, GstObject* parent,
                                           GstBuffer* buf);
static void gst_est_net_sim_reset_stream_locked(GstEstNetSim* self);
static void gst_est_net_sim_forget_stream_locked(GstEstNetSim* self);
static gboolean gst_est_net_sim_should_drop_locked(GstEstNetSim* self);

static GType gst_est_net_sim_packetloss_type_get_type(void) {
    static gsize type_id = 0;

    if (g_once_init_enter(&type_id)) {
        static const GEnumValue values[] = {
            {GST_EST_NET_SIM_PACKETLOSS_NONE, "No packet loss", "none"},
            {GST_EST_NET_SIM_PACKETLOSS_RANDOM,
             "Independent random packet loss",
             "random"},
            {GST_EST_NET_SIM_PACKETLOSS_BURSTY, "Bursty packet loss", "bursty"},
            {0, NULL, NULL}};
        GType id = g_enum_register_static("GstEstNetSimPacketLossType", values);
        g_once_init_leave(&type_id, id);
    }

    return (GType)type_id;
}

static GType gst_est_net_sim_burst_model_get_type(void) {
    static gsize type_id = 0;

    if (g_once_init_enter(&type_id)) {
        static const GEnumValue values[] = {
            {GST_EST_NET_SIM_BURST_MODEL_G107_MARKOV,
             "ITU-T G.107 two-state Markov model",
             "g107-markov"},
            {0, NULL, NULL}};
        GType id = g_enum_register_static("GstEstNetSimBurstModel", values);
        g_once_init_leave(&type_id, id);
    }

    return (GType)type_id;
}

static void gst_est_net_sim_install_properties(GObjectClass* gobject_class) {
    g_object_class_install_property(
        gobject_class,
        PROP_PACKETLOSS_TYPE,
        g_param_spec_enum("packetloss-type",
                          "Packet loss type",
                          "Packet loss generation type",
                          GST_TYPE_EST_NET_SIM_PACKETLOSS_TYPE,
                          DEFAULT_PACKETLOSS_TYPE,
                          G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));

    g_object_class_install_property(
        gobject_class,
        PROP_PACKETLOSS_RATIO,
        g_param_spec_double(
            "packetloss-ratio",
            "Packet loss ratio",
            "Packet loss ratio as a fraction between 0.0 and 1.0",
            0.0,
            1.0,
            DEFAULT_PACKETLOSS_RATIO,
            G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));

    g_object_class_install_property(
        gobject_class,
        PROP_PACKETLOSS_SEED,
        g_param_spec_uint("packetloss-seed",
                          "Packet loss seed",
                          "Seed for reproducible packet loss; 0 chooses a "
                          "random seed per stream",
                          0,
                          G_MAXUINT,
                          DEFAULT_PACKETLOSS_SEED,
                          G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));

    g_object_class_install_property(
        gobject_class,
        PROP_PACKETLOSS_BURST_MODEL,
        g_param_spec_enum("packetloss-burst-model",
                          "Packet loss burst model",
                          "Model used to generate bursty packet loss",
                          GST_TYPE_EST_NET_SIM_BURST_MODEL,
                          DEFAULT_PACKETLOSS_BURST_MODEL,
                          G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));

    g_object_class_install_property(
        gobject_class,
        PROP_PACKETLOSS_BURST_RATIO,
        g_param_spec_double(
            "packetloss-burst-ratio",
            "Packet loss burst ratio",
            "ITU-T G.107 BurstR value used by bursty packet loss",
            1.0,
            8.0,
            DEFAULT_PACKETLOSS_BURST_RATIO,
            G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));
}

static void gst_est_net_sim_class_init(GstEstNetSimClass* klass) {
    GObjectClass* gobject_class = G_OBJECT_CLASS(klass);
    GstElementClass* element_class = GST_ELEMENT_CLASS(klass);

    gobject_class->set_property = gst_est_net_sim_set_property;
    gobject_class->get_property = gst_est_net_sim_get_property;
    gobject_class->finalize = gst_est_net_sim_finalize;

    element_class->change_state =
        GST_DEBUG_FUNCPTR(gst_est_net_sim_change_state);

    gst_est_net_sim_install_properties(gobject_class);

    gst_element_class_set_static_metadata(
        element_class,
        "EffectStreamer Network Simulator",
        "Filter/Network",
        "Drops buffers to simulate random or bursty packet loss",
        "Eero Kaan | Quality and Usability Lab | TU Berlin");

    gst_element_class_add_static_pad_template(element_class, &src_template);
    gst_element_class_add_static_pad_template(element_class, &sink_template);

    GST_DEBUG_CATEGORY_INIT(gst_est_net_sim_debug,
                            "estnetsim",
                            0,
                            "EffectStreamer Network Simulator");
}

static void gst_est_net_sim_init(GstEstNetSim* self) {
    self->sinkpad = gst_pad_new_from_static_template(&sink_template, "sink");
    gst_pad_set_event_function(self->sinkpad,
                               GST_DEBUG_FUNCPTR(gst_est_net_sim_sink_event));
    gst_pad_set_chain_function(self->sinkpad,
                               GST_DEBUG_FUNCPTR(gst_est_net_sim_chain));
    GST_OBJECT_FLAG_SET(
        self->sinkpad, GST_PAD_FLAG_PROXY_CAPS | GST_PAD_FLAG_PROXY_ALLOCATION);
    gst_element_add_pad(GST_ELEMENT(self), self->sinkpad);

    self->srcpad = gst_pad_new_from_static_template(&src_template, "src");
    GST_OBJECT_FLAG_SET(
        self->srcpad, GST_PAD_FLAG_PROXY_CAPS | GST_PAD_FLAG_PROXY_ALLOCATION);
    gst_element_add_pad(GST_ELEMENT(self), self->srcpad);

    g_mutex_init(&self->lock);
    self->packetloss_type = DEFAULT_PACKETLOSS_TYPE;
    self->packetloss_ratio = DEFAULT_PACKETLOSS_RATIO;
    self->packetloss_seed = DEFAULT_PACKETLOSS_SEED;
    self->packetloss_burst_model = DEFAULT_PACKETLOSS_BURST_MODEL;
    self->packetloss_burst_ratio = DEFAULT_PACKETLOSS_BURST_RATIO;
    self->rng = NULL;
    self->active_seed = 0;
    self->loss_state = FALSE;
}

static void gst_est_net_sim_set_property(GObject* object, guint prop_id,
                                         const GValue* value,
                                         GParamSpec* pspec) {
    GstEstNetSim* self = GST_EST_NET_SIM(object);

    g_mutex_lock(&self->lock);
    switch (prop_id) {
        case PROP_PACKETLOSS_TYPE:
            self->packetloss_type = g_value_get_enum(value);
            self->loss_state = FALSE;
            break;
        case PROP_PACKETLOSS_RATIO:
            self->packetloss_ratio = g_value_get_double(value);
            if (self->packetloss_ratio <= 0.0 || self->packetloss_ratio >= 1.0)
                self->loss_state = FALSE;
            break;
        case PROP_PACKETLOSS_SEED:
            self->packetloss_seed = g_value_get_uint(value);
            gst_est_net_sim_reset_stream_locked(self);
            break;
        case PROP_PACKETLOSS_BURST_MODEL:
            self->packetloss_burst_model = g_value_get_enum(value);
            self->loss_state = FALSE;
            break;
        case PROP_PACKETLOSS_BURST_RATIO:
            self->packetloss_burst_ratio = g_value_get_double(value);
            self->loss_state = FALSE;
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
            break;
    }
    g_mutex_unlock(&self->lock);
}

static void gst_est_net_sim_get_property(GObject* object, guint prop_id,
                                         GValue* value, GParamSpec* pspec) {
    GstEstNetSim* self = GST_EST_NET_SIM(object);

    g_mutex_lock(&self->lock);
    switch (prop_id) {
        case PROP_PACKETLOSS_TYPE:
            g_value_set_enum(value, self->packetloss_type);
            break;
        case PROP_PACKETLOSS_RATIO:
            g_value_set_double(value, self->packetloss_ratio);
            break;
        case PROP_PACKETLOSS_SEED:
            g_value_set_uint(value, self->packetloss_seed);
            break;
        case PROP_PACKETLOSS_BURST_MODEL:
            g_value_set_enum(value, self->packetloss_burst_model);
            break;
        case PROP_PACKETLOSS_BURST_RATIO:
            g_value_set_double(value, self->packetloss_burst_ratio);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID(object, prop_id, pspec);
            break;
    }
    g_mutex_unlock(&self->lock);
}

static void gst_est_net_sim_finalize(GObject* object) {
    GstEstNetSim* self = GST_EST_NET_SIM(object);

    if (self->rng != NULL) {
        g_rand_free(self->rng);
        self->rng = NULL;
    }
    g_mutex_clear(&self->lock);

    G_OBJECT_CLASS(parent_class)->finalize(object);
}

static void gst_est_net_sim_reset_stream_locked(GstEstNetSim* self) {
    guint seed;

    if (self->rng != NULL) {
        g_rand_free(self->rng);
        self->rng = NULL;
    }

    seed = self->packetloss_seed != 0 ? self->packetloss_seed : g_random_int();
    self->rng = g_rand_new_with_seed(seed);
    self->active_seed = seed;
    self->loss_state = FALSE;

    GST_DEBUG_OBJECT(self,
                     "Reset packet loss stream with active seed %u",
                     self->active_seed);
}

static void gst_est_net_sim_forget_stream_locked(GstEstNetSim* self) {
    if (self->rng != NULL) {
        g_rand_free(self->rng);
        self->rng = NULL;
    }

    self->active_seed = 0;
    self->loss_state = FALSE;

    GST_DEBUG_OBJECT(self, "Forgot packet loss stream state");
}

static gboolean gst_est_net_sim_should_drop_locked(GstEstNetSim* self) {
    gdouble ratio = self->packetloss_ratio;

    if (self->packetloss_type == GST_EST_NET_SIM_PACKETLOSS_NONE ||
        ratio <= 0.0)
        return FALSE;

    if (ratio >= 1.0) return TRUE;

    if (self->rng == NULL) gst_est_net_sim_reset_stream_locked(self);

    switch (self->packetloss_type) {
        case GST_EST_NET_SIM_PACKETLOSS_RANDOM:
            return g_rand_double(self->rng) < ratio;
        case GST_EST_NET_SIM_PACKETLOSS_BURSTY: {
            gdouble burst_ratio = MAX(self->packetloss_burst_ratio, 1.0);
            gdouble transition;

            if (self->packetloss_burst_model !=
                GST_EST_NET_SIM_BURST_MODEL_G107_MARKOV)
                return FALSE;

            if (self->loss_state) {
                transition = (1.0 - ratio) / burst_ratio;
                if (g_rand_double(self->rng) < transition) {
                    self->loss_state = FALSE;
                    return FALSE;
                }
                return TRUE;
            }

            transition = ratio / burst_ratio;
            if (g_rand_double(self->rng) < transition) {
                self->loss_state = TRUE;
                return TRUE;
            }
            return FALSE;
        }
        case GST_EST_NET_SIM_PACKETLOSS_NONE:
        default:
            return FALSE;
    }
}

static GstStateChangeReturn gst_est_net_sim_change_state(
    GstElement* element, GstStateChange transition) {
    GstEstNetSim* self = GST_EST_NET_SIM(element);
    GstStateChangeReturn ret;

    switch (transition) {
        case GST_STATE_CHANGE_READY_TO_PAUSED:
            g_mutex_lock(&self->lock);
            gst_est_net_sim_reset_stream_locked(self);
            g_mutex_unlock(&self->lock);
            break;
        default:
            break;
    }

    ret = GST_ELEMENT_CLASS(parent_class)->change_state(element, transition);
    if (ret == GST_STATE_CHANGE_FAILURE) return ret;

    switch (transition) {
        case GST_STATE_CHANGE_PAUSED_TO_READY:
            g_mutex_lock(&self->lock);
            gst_est_net_sim_forget_stream_locked(self);
            g_mutex_unlock(&self->lock);
            break;
        default:
            break;
    }

    return ret;
}

static gboolean gst_est_net_sim_sink_event(GstPad* pad, GstObject* parent,
                                           GstEvent* event) {
    GstEstNetSim* self = GST_EST_NET_SIM(parent);

    GST_LOG_OBJECT(self, "Received %s event", GST_EVENT_TYPE_NAME(event));

    switch (GST_EVENT_TYPE(event)) {
        case GST_EVENT_STREAM_START:
            g_mutex_lock(&self->lock);
            gst_est_net_sim_reset_stream_locked(self);
            g_mutex_unlock(&self->lock);
            return gst_pad_push_event(self->srcpad, event);
        case GST_EVENT_CAPS:
        case GST_EVENT_SEGMENT:
        case GST_EVENT_TAG:
        case GST_EVENT_EOS:
        case GST_EVENT_FLUSH_START:
        case GST_EVENT_FLUSH_STOP:
            return gst_pad_push_event(self->srcpad, event);
        default:
            return gst_pad_event_default(pad, parent, event);
    }
}

static GstFlowReturn gst_est_net_sim_chain(GstPad* pad, GstObject* parent,
                                           GstBuffer* buf) {
    GstEstNetSim* self = GST_EST_NET_SIM(parent);
    gboolean drop;

    g_mutex_lock(&self->lock);
    drop = gst_est_net_sim_should_drop_locked(self);
    g_mutex_unlock(&self->lock);

    if (drop) {
        GST_LOG_OBJECT(self,
                       "Dropping buffer of size %" G_GSIZE_FORMAT,
                       gst_buffer_get_size(buf));
        gst_buffer_unref(buf);
        return GST_FLOW_OK;
    }

    return gst_pad_push(self->srcpad, buf);
}

static gboolean plugin_init(GstPlugin* plugin) {
    return gst_element_register(
        plugin, "estnetsim", GST_RANK_NONE, GST_TYPE_EST_NET_SIM);
}

#ifndef PACKAGE
#define PACKAGE "estnetsim"
#endif

GST_PLUGIN_DEFINE(GST_VERSION_MAJOR, GST_VERSION_MINOR, estnetsim,
                  "EffectStreamer Network Simulator", plugin_init,
                  PACKAGE_VERSION, GST_LICENSE, GST_PACKAGE_NAME,
                  GST_PACKAGE_ORIGIN)
