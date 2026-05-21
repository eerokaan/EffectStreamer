/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include <errno.h>
#include <getopt.h>
#include <limits.h>
#include <math.h>

#include "effectstreamer.h"

static void print_usage(const char* prog_name) {
    fprintf(stderr, "\n");
    fprintf(stderr, "EffectStreamer Core\n");
    fprintf(stderr, "Platform: %s\n\n", get_platform_name());

    fprintf(stderr, "Usage (Sender mode):\n");
    fprintf(stderr,
            "  %s --mode sender [--device <DEVICE-ID>] --peerip <IP-ADDRESS> [--native-delay <MS>] [--echo-delay <MS>] "
            "[--packetloss-type <none|random|bursty>] [--packetloss-ratio <0.0-1.0>] [--packetloss-seed <INT>] "
            "[--packetloss-burst-model <g107-markov>] [--packetloss-burst-ratio <1.0-8.0>] [--help]\n\n",
            prog_name);

    fprintf(stderr, "Usage (Receiver mode):\n");
    fprintf(stderr, "  %s --mode receiver [--device <DEVICE-ID>] [--native-gain <GAIN>] [--echo-gain <GAIN>]\n\n", prog_name);

    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  --mode                    Mode of operation: 'sender' or 'receiver'\n");
    fprintf(stderr, "  --device                  Audio device ID (optional, auto-detects if not provided)\n");
    fprintf(stderr, "  --peerip                  IP address of the peer receiver (sender mode only)\n");
    fprintf(stderr, "  --native-delay            The native delay in milliseconds (sender mode only, default: 0)\n");
    fprintf(stderr, "  --native-gain             The native gain, e.g., 0.5 (receiver mode only, default: 1.0)\n");
    fprintf(stderr, "  --echo-delay              The echo delay in milliseconds (sender mode only, default: 0)\n");
    fprintf(stderr, "  --echo-gain               The echo gain, e.g., 0.5 (receiver mode only, default: 1.0)\n");
    fprintf(stderr, "  --packetloss-type         Packet loss type: 'none', 'random', or 'bursty' (sender mode only, default: none)\n");
    fprintf(stderr, "  --packetloss-ratio        Packet loss ratio from 0.0 to 1.0 (sender mode only, default: 0.0)\n");
    fprintf(stderr, "  --packetloss-seed         Packet loss seed; 0 chooses a random seed per stream (sender mode only, default: 0)\n");
    fprintf(stderr, "  --packetloss-burst-model  Packet loss burst model: 'g107-markov' (sender mode only, default: g107-markov)\n");
    fprintf(stderr, "  --packetloss-burst-ratio  Packet loss burst ratio from 1.0 to 8.0 (sender mode only, default: 1.0)\n");
    fprintf(stderr, "  --help                    Show this help message\n");
    fprintf(stderr, "\n");
}

static gboolean parse_double_option(const char* value, const char* option_name, double min, double max, double* out) {
    char* endptr;
    double parsed;

    errno = 0;
    parsed = strtod(value, &endptr);
    if (errno == ERANGE || endptr == value || *endptr != '\0' || !isfinite(parsed) || parsed < min || parsed > max) {
        fprintf(stderr, "Error: Invalid value for %s: '%s' (expected %.1f to %.1f)\n", option_name, value, min, max);
        return FALSE;
    }

    *out = parsed;
    return TRUE;
}

static gboolean parse_uint_option(const char* value, const char* option_name, guint* out) {
    char* endptr;
    unsigned long parsed;

    if (value[0] == '-') {
        fprintf(stderr, "Error: Invalid value for %s: '%s' (expected 0 to %u)\n", option_name, value, G_MAXUINT);
        return FALSE;
    }

    errno = 0;
    parsed = strtoul(value, &endptr, 10);
    if (errno == ERANGE || endptr == value || *endptr != '\0' || parsed > G_MAXUINT) {
        fprintf(stderr, "Error: Invalid value for %s: '%s' (expected 0 to %u)\n", option_name, value, G_MAXUINT);
        return FALSE;
    }

    *out = (guint)parsed;
    return TRUE;
}

static gboolean is_valid_packetloss_type(const char* value) {
    return strcmp(value, "none") == 0 || strcmp(value, "random") == 0 || strcmp(value, "bursty") == 0;
}

static gboolean is_valid_packetloss_burst_model(const char* value) { return strcmp(value, "g107-markov") == 0; }

int main(int argc, char* argv[]) {
    int opt;
    char* mode = NULL;
    char* device = NULL;
    char* peerip = NULL;
    int nativedelay = 0;
    int echodelay = 0;
    double nativegain = 1.0;
    double echogain = 1.0;
    const char* packetloss_type = "none";
    double packetloss_ratio = 0.0;
    guint packetloss_seed = 0;
    const char* packetloss_burst_model = "g107-markov";
    double packetloss_burst_ratio = 1.0;
    gboolean packetloss_option_provided = FALSE;
    int ret = 0;

    enum {
        OPT_MODE = 1,
        OPT_DEVICE,
        OPT_PEERIP,
        OPT_NATIVEDELAY,
        OPT_ECHODELAY,
        OPT_NATIVEGAIN,
        OPT_ECHOGAIN,
        OPT_PACKETLOSS_TYPE,
        OPT_PACKETLOSS_RATIO,
        OPT_PACKETLOSS_SEED,
        OPT_PACKETLOSS_BURST_MODEL,
        OPT_PACKETLOSS_BURST_RATIO,
        OPT_HELP
    };

    static struct option long_options[] = {{"mode", required_argument, 0, OPT_MODE},
                                           {"device", required_argument, 0, OPT_DEVICE},
                                           {"peerip", required_argument, 0, OPT_PEERIP},
                                           {"native-delay", required_argument, 0, OPT_NATIVEDELAY},
                                           {"echo-delay", required_argument, 0, OPT_ECHODELAY},
                                           {"native-gain", required_argument, 0, OPT_NATIVEGAIN},
                                           {"echo-gain", required_argument, 0, OPT_ECHOGAIN},
                                           {"packetloss-type", required_argument, 0, OPT_PACKETLOSS_TYPE},
                                           {"packetloss-ratio", required_argument, 0, OPT_PACKETLOSS_RATIO},
                                           {"packetloss-seed", required_argument, 0, OPT_PACKETLOSS_SEED},
                                           {"packetloss-burst-model", required_argument, 0, OPT_PACKETLOSS_BURST_MODEL},
                                           {"packetloss-burst-ratio", required_argument, 0, OPT_PACKETLOSS_BURST_RATIO},
                                           {"help", no_argument, 0, OPT_HELP},
                                           {0, 0, 0, 0}};

    /* Parse command-line arguments */
    while (1) {
        int option_index = 0;
        opt = getopt_long(argc, argv, "", long_options, &option_index);

        if (opt == -1) break;

        switch (opt) {
            case OPT_MODE:
                mode = optarg;
                break;
            case OPT_DEVICE:
                device = optarg;
                break;
            case OPT_PEERIP:
                peerip = optarg;
                break;
            case OPT_NATIVEDELAY:
                nativedelay = atoi(optarg);
                break;
            case OPT_ECHODELAY:
                echodelay = atoi(optarg);
                break;
            case OPT_NATIVEGAIN:
                nativegain = atof(optarg);
                break;
            case OPT_ECHOGAIN:
                echogain = atof(optarg);
                break;
            case OPT_PACKETLOSS_TYPE:
                packetloss_option_provided = TRUE;
                if (!is_valid_packetloss_type(optarg)) {
                    fprintf(stderr, "Error: Invalid --packetloss-type '%s' (expected none, random, or bursty)\n", optarg);
                    print_usage(argv[0]);
                    return 1;
                }
                packetloss_type = optarg;
                break;
            case OPT_PACKETLOSS_RATIO:
                packetloss_option_provided = TRUE;
                if (!parse_double_option(optarg, "--packetloss-ratio", 0.0, 1.0, &packetloss_ratio)) {
                    print_usage(argv[0]);
                    return 1;
                }
                break;
            case OPT_PACKETLOSS_SEED:
                packetloss_option_provided = TRUE;
                if (!parse_uint_option(optarg, "--packetloss-seed", &packetloss_seed)) {
                    print_usage(argv[0]);
                    return 1;
                }
                break;
            case OPT_PACKETLOSS_BURST_MODEL:
                packetloss_option_provided = TRUE;
                if (!is_valid_packetloss_burst_model(optarg)) {
                    fprintf(stderr, "Error: Invalid --packetloss-burst-model '%s' (expected g107-markov)\n", optarg);
                    print_usage(argv[0]);
                    return 1;
                }
                packetloss_burst_model = optarg;
                break;
            case OPT_PACKETLOSS_BURST_RATIO:
                packetloss_option_provided = TRUE;
                if (!parse_double_option(optarg, "--packetloss-burst-ratio", 1.0, 8.0, &packetloss_burst_ratio)) {
                    print_usage(argv[0]);
                    return 1;
                }
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
    if (!mode) {
        fprintf(stderr, "Error: --mode parameter is required\n");
        print_usage(argv[0]);
        return 1;
    }

    /* Run in appropriate mode */
    if (strcmp(mode, "sender") == 0) {
        /* Validate sender parameters */
        if (!peerip) {
            fprintf(stderr, "Error: Missing required parameter for sender mode (--peerip)\n");
            print_usage(argv[0]);
            return 1;
        }

        if (strcmp(packetloss_type, "none") == 0 && packetloss_ratio > 0.0) {
            fprintf(stderr, "Error: --packetloss-ratio requires --packetloss-type random or bursty\n");
            print_usage(argv[0]);
            return 1;
        }

        /* Handle device parameter */
        gboolean auto_detected = FALSE;
        if (!device) {
            device = get_first_audio_device(TRUE); /* TRUE = source */
            if (!device) {
                fprintf(stderr, "Error: Could not auto-detect audio source device\n");
                return 1;
            }
            g_print("Auto-detected audio source: %s\n", device);
            auto_detected = TRUE;
        }

        SenderParams params = {.device = device,
                               .peerip = peerip,
                               .nativedelay = nativedelay,
                               .echodelay = echodelay,
                               .packetloss_type = packetloss_type,
                               .packetloss_ratio = packetloss_ratio,
                               .packetloss_seed = packetloss_seed,
                               .packetloss_burst_model = packetloss_burst_model,
                               .packetloss_burst_ratio = packetloss_burst_ratio};

        ret = run_sender(&params);

        if (auto_detected) {
            g_free(device);
        }
    } else if (strcmp(mode, "receiver") == 0) {
        if (packetloss_option_provided) {
            fprintf(stderr, "Error: Packet loss options are only supported in sender mode\n");
            print_usage(argv[0]);
            return 1;
        }

        /* Handle device parameter */
        gboolean auto_detected = FALSE;
        if (!device) {
            device = get_first_audio_device(FALSE); /* FALSE = sink */
            if (!device) {
                fprintf(stderr, "Error: Could not auto-detect audio sink device\n");
                return 1;
            }
            g_print("Auto-detected audio sink: %s\n", device);
            auto_detected = TRUE;
        }

        ReceiverParams params = {.device = device, .nativegain = nativegain, .echogain = echogain};

        ret = run_receiver(&params);

        if (auto_detected) {
            g_free(device);
        }
    } else {
        fprintf(stderr, "Error: Invalid mode '%s'. Must be 'sender' or 'receiver'\n", mode);
        print_usage(argv[0]);
        return 1;
    }

    /* Cleanup */
    gst_deinit();

    return ret;
}
