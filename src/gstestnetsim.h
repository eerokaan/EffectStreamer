/*
 * ╔════════════════════════════════════════╗
 * ║ EffectStreamer NetSim GStreamer Plugin ║
 * ║ Quality and Usability Lab / TU Berlin  ║
 * ╚════════════════════════════════════════╝
 */

#ifndef __GST_EST_NET_SIM_H__
#define __GST_EST_NET_SIM_H__

#include <gst/gst.h>

G_BEGIN_DECLS

typedef enum
{
    GST_EST_NET_SIM_PACKETLOSS_NONE,
    GST_EST_NET_SIM_PACKETLOSS_RANDOM,
    GST_EST_NET_SIM_PACKETLOSS_BURSTY,
} GstEstNetSimPacketLossType;

typedef enum
{
    GST_EST_NET_SIM_BURST_MODEL_G107_MARKOV,
} GstEstNetSimBurstModel;

#define GST_TYPE_EST_NET_SIM (gst_est_net_sim_get_type())
G_DECLARE_FINAL_TYPE(GstEstNetSim, gst_est_net_sim, GST, EST_NET_SIM,
                     GstElement)

struct _GstEstNetSim
{
    GstElement element;

    GstPad *sinkpad;
    GstPad *srcpad;

    GMutex lock;
    GstEstNetSimPacketLossType packetloss_type;
    gdouble packetloss_ratio;
    guint packetloss_seed;
    GstEstNetSimBurstModel packetloss_burst_model;
    gdouble packetloss_burst_ratio;

    GRand *rng;
    guint active_seed;
    gboolean loss_state;
};

G_END_DECLS

#endif /* __GST_EST_NET_SIM_H__ */
