/*
 * ╔═══════════════════════════════════════╗
 * ║ Quality and Usability Lab / TU Berlin ║
 * ║ EchoStreamer (Main)                   ║
 * ╚═══════════════════════════════════════╝
 */

#include "echostreamer.h"
#include <getopt.h>

static void print_usage(const char *prog_name) {
    fprintf(stderr, "\n");
    fprintf(stderr, "EchoStreamer - Audio streaming for echo simulation\n");
    fprintf(stderr, "Platform: %s\n\n", get_platform_name());
    
    fprintf(stderr, "Usage (Sender mode):\n");
    fprintf(stderr, "  %s --mode sender [--device <DEVICE-ID>] --peerip <IP-ADDRESS> --latency <MS>\n\n", prog_name);
    
    fprintf(stderr, "Usage (Receiver mode):\n");
    fprintf(stderr, "  %s --mode receiver [--device <DEVICE-ID>] --gain <GAIN>\n\n", prog_name);
    
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  --mode       Mode of operation: 'sender' or 'receiver'\n");
    fprintf(stderr, "  --device     Audio device ID (optional, auto-detects if not provided)\n");
    fprintf(stderr, "  --peerip     IP address of the peer receiver (sender mode only)\n");
    fprintf(stderr, "  --latency    Latency in milliseconds (sender mode only)\n");
    fprintf(stderr, "  --gain       Echo volume gain, e.g., 0.5 (receiver mode only)\n");
    fprintf(stderr, "  --help       Show this help message\n");
    fprintf(stderr, "\n");
}

int main(int argc, char *argv[]) {
    int opt;
    char *mode = NULL;
    char *device = NULL;
    char *peerip = NULL;
    int latency = -1;
    double gain = -1.0;
    int ret = 0;

    static struct option long_options[] = {
        {"mode",    required_argument, 0, 'm'},
        {"device",  required_argument, 0, 'd'},
        {"peerip",  required_argument, 0, 'p'},
        {"latency", required_argument, 0, 'l'},
        {"gain",    required_argument, 0, 'g'},
        {"help",    no_argument,       0, 'h'},
        {0, 0, 0, 0}
    };

    /* Parse command-line arguments */
    while (1) {
        int option_index = 0;
        opt = getopt_long(argc, argv, "m:d:p:l:g:h", long_options, &option_index);

        if (opt == -1)
            break;

        switch (opt) {
            case 'm':
                mode = optarg;
                break;
            case 'd':
                device = optarg;
                break;
            case 'p':
                peerip = optarg;
                break;
            case 'l':
                latency = atoi(optarg);
                break;
            case 'g':
                gain = atof(optarg);
                break;
            case 'h':
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
        if (!peerip || latency < 0) {
            fprintf(stderr, "Error: Missing required parameters for sender mode (--peerip and --latency)\n");
            print_usage(argv[0]);
            return 1;
        }
        
        /* Handle device parameter */
        gboolean auto_detected = FALSE;
        if (!device) {
            device = get_first_audio_device(TRUE);  /* TRUE = source */
            if (!device) {
                fprintf(stderr, "Error: Could not auto-detect audio source device\n");
                return 1;
            }
            g_print("Auto-detected audio source: %s\n", device);
            auto_detected = TRUE;
        }

        SenderParams params = {
            .device = device,
            .peerip = peerip,
            .latency = latency
        };

        ret = run_sender(&params);

        if (auto_detected) {
            g_free(device);
        }

    } else if (strcmp(mode, "receiver") == 0) {
        /* Validate receiver parameters */
        if (gain < 0.0) {
            fprintf(stderr, "Error: Missing required parameter for receiver mode (--gain)\n");
            print_usage(argv[0]);
            return 1;
        }
        
        /* Handle device parameter */
        gboolean auto_detected = FALSE;
        if (!device) {
            device = get_first_audio_device(FALSE);  /* FALSE = sink */
            if (!device) {
                fprintf(stderr, "Error: Could not auto-detect audio sink device\n");
                return 1;
            }
            g_print("Auto-detected audio sink: %s\n", device);
            auto_detected = TRUE;
        }

        ReceiverParams params = {
            .device = device,
            .gain = gain
        };

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
