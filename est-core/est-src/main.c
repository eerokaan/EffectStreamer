/*
 * ╔═══════════════════════════════════════╗
 * ║ Quality and Usability Lab / TU Berlin ║
 * ║ EffectStreamer (Main)                 ║
 * ╚═══════════════════════════════════════╝
 */

#include "effectstreamer.h"
#include <getopt.h>

static void print_usage(const char *prog_name)
{
    fprintf(stderr, "\n");
    fprintf(stderr, "EffectStreamer Core\n");
    fprintf(stderr, "Platform: %s\n\n", get_platform_name());

    fprintf(stderr, "Usage (Sender mode):\n");
    fprintf(stderr, "  %s --mode sender [--device <DEVICE-ID>] --peerip <IP-ADDRESS> --echo-delay <MS>\n\n", prog_name);

    fprintf(stderr, "Usage (Receiver mode):\n");
    fprintf(stderr, "  %s --mode receiver [--device <DEVICE-ID>] --echo-gain <GAIN>\n\n", prog_name);

    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  --mode        Mode of operation: 'sender' or 'receiver'\n");
    fprintf(stderr, "  --device      Audio device ID (optional, auto-detects if not provided)\n");
    fprintf(stderr, "  --peerip      IP address of the peer receiver (sender mode only)\n");
    fprintf(stderr, "  --echo-delay  The echo delay in milliseconds (sender mode only)\n");
    fprintf(stderr, "  --echo-gain   The echo gain, e.g., 0.5 (receiver mode only)\n");
    fprintf(stderr, "  --help        Show this help message\n");
    fprintf(stderr, "\n");
}

int main(int argc, char *argv[])
{
    int opt;
    char *mode = NULL;
    char *device = NULL;
    char *peerip = NULL;
    int echodelay = -1;
    double echogain = -1.0;
    int ret = 0;

    enum
    {
        OPT_MODE = 1,
        OPT_DEVICE,
        OPT_PEERIP,
        OPT_ECHODELAY,
        OPT_ECHOGAIN,
        OPT_HELP
    };

    static struct option long_options[] = {
        {"mode", required_argument, 0, OPT_MODE},
        {"device", required_argument, 0, OPT_DEVICE},
        {"peerip", required_argument, 0, OPT_PEERIP},
        {"echo-delay", required_argument, 0, OPT_ECHODELAY},
        {"echo-gain", required_argument, 0, OPT_ECHOGAIN},
        {"help", no_argument, 0, OPT_HELP},
        {0, 0, 0, 0}};

    /* Parse command-line arguments */
    while (1)
    {
        int option_index = 0;
        opt = getopt_long(argc, argv, "", long_options, &option_index);

        if (opt == -1)
            break;

        switch (opt)
        {
        case OPT_MODE:
            mode = optarg;
            break;
        case OPT_DEVICE:
            device = optarg;
            break;
        case OPT_PEERIP:
            peerip = optarg;
            break;
        case OPT_ECHODELAY:
            echodelay = atoi(optarg);
            break;
        case OPT_ECHOGAIN:
            echogain = atof(optarg);
            break;
        case OPT_HELP:
            print_usage(argv[0]);
            return 0;
        default:
            print_usage(argv[0]);
            return 1;
        }
    }

    /* Initialize GStreamer */
    gst_init(&argc, &argv);

    /* Validate mode */
    if (!mode)
    {
        fprintf(stderr, "Error: --mode parameter is required\n");
        print_usage(argv[0]);
        return 1;
    }

    /* Run in appropriate mode */
    if (strcmp(mode, "sender") == 0)
    {
        /* Validate sender parameters */
        if (!peerip || echodelay < 0)
        {
            fprintf(stderr, "Error: Missing required parameters for sender mode (--peerip and --echo-delay)\n");
            print_usage(argv[0]);
            return 1;
        }

        /* Handle device parameter */
        gboolean auto_detected = FALSE;
        if (!device)
        {
            device = get_first_audio_device(TRUE); /* TRUE = source */
            if (!device)
            {
                fprintf(stderr, "Error: Could not auto-detect audio source device\n");
                return 1;
            }
            g_print("Auto-detected audio source: %s\n", device);
            auto_detected = TRUE;
        }

        SenderParams params = {
            .device = device,
            .peerip = peerip,
            .echodelay = echodelay};

        ret = run_sender(&params);

        if (auto_detected)
        {
            g_free(device);
        }
    }
    else if (strcmp(mode, "receiver") == 0)
    {
        /* Validate receiver parameters */
        if (echogain < 0.0)
        {
            fprintf(stderr, "Error: Missing required parameter for receiver mode (--echo-gain)\n");
            print_usage(argv[0]);
            return 1;
        }

        /* Handle device parameter */
        gboolean auto_detected = FALSE;
        if (!device)
        {
            device = get_first_audio_device(FALSE); /* FALSE = sink */
            if (!device)
            {
                fprintf(stderr, "Error: Could not auto-detect audio sink device\n");
                return 1;
            }
            g_print("Auto-detected audio sink: %s\n", device);
            auto_detected = TRUE;
        }

        ReceiverParams params = {
            .device = device,
            .echogain = echogain};

        ret = run_receiver(&params);

        if (auto_detected)
        {
            g_free(device);
        }
    }
    else
    {
        fprintf(stderr, "Error: Invalid mode '%s'. Must be 'sender' or 'receiver'\n", mode);
        print_usage(argv[0]);
        return 1;
    }

    /* Cleanup */
    gst_deinit();

    return ret;
}
