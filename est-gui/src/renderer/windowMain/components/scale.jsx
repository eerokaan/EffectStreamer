import { useRef } from "react";
import useStoreComponentScale from "@/stores/component-scale";
import imgAudioQuality from "@/assets/img/scales/01_audio_quality.png";
import imgColoration from "@/assets/img/scales/02_coloration.png";
import imgDiscontinuity from "@/assets/img/scales/03_discontinuity.png";
import imgDegradation from "@/assets/img/scales/04_degradation.png";
import imgEcho from "@/assets/img/scales/05_echo.png";
import imgInteraction from "@/assets/img/scales/06_interaction.png";
import imgLoudness from "@/assets/img/scales/07_loudness.png";
import imgNoisiness from "@/assets/img/scales/08_noisiness.png";

const imageWidth = 4200;
const imageHeight = 575;
const fixedY = 115;

const scaleClasses = {
    class01: { xMin: 223, xMax: 3971 },
    class02: { xMin: 102, xMax: 4090 }
};

const scales = {
    audio_quality: { scaleClass: "class01", image: imgAudioQuality },
    coloration: { scaleClass: "class02", image: imgColoration },
    discontinuity: { scaleClass: "class02", image: imgDiscontinuity },
    degradation: { scaleClass: "class02", image: imgDegradation },
    echo: { scaleClass: "class02", image: imgEcho },
    interaction: { scaleClass: "class02", image: imgInteraction },
    loudness: { scaleClass: "class02", image: imgLoudness },
    noisiness: { scaleClass: "class02", image: imgNoisiness }
};

function ComponentScale({ scaleName }) {
    const { scaleValues, setScaleValues } = useStoreComponentScale();
    const imgReference = useRef(null);

    const scaleInfo = scales[scaleName];
    const { xMin, xMax } = scaleClasses[scaleInfo.scaleClass];

    // Derive marker position directly from the store value
    const storedValue = scaleValues[scaleName];
    const markerPercentage =
        storedValue != null
            ? {
                  leftPercentage: ((storedValue * (xMax - xMin) + xMin) / imageWidth) * 100,
                  topPercentage: (fixedY / imageHeight) * 100
              }
            : null;

    // Handle click on the transparent overlay
    function handleClick(event) {
        const img = imgReference.current;
        if (!img) return;

        const rect = img.getBoundingClientRect();
        const scaleRatio = imageWidth / rect.width;

        // Convert click position to native image coordinates
        const nativeX = (event.clientX - rect.left) * scaleRatio;
        const clampedX = Math.max(xMin, Math.min(xMax, nativeX));
        const normalized = (clampedX - xMin) / (xMax - xMin);

        // Save normalized value to store; marker re-derives on re-render
        setScaleValues({ ...scaleValues, [scaleName]: normalized });
    }

    return (
        <>
            <div className="relative inline-block select-none">
                <img ref={imgReference} src={scaleInfo.image} alt="Scale Image" className="block w-full" draggable="false" />
                <div className="absolute inset-0 cursor-crosshair" onClick={handleClick} />

                {markerPercentage && (
                    <div
                        className="pointer-events-none absolute"
                        style={{
                            left: `${markerPercentage.leftPercentage}%`,
                            top: `${markerPercentage.topPercentage}%`,
                            transform: "translate(-50%, -50%)"
                        }}
                    >
                        <svg width="48" height="48" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <line x1="2" y1="2" x2="22" y2="22" stroke="red" strokeWidth="3" />
                            <line x1="22" y1="2" x2="2" y2="22" stroke="red" strokeWidth="3" />
                        </svg>
                    </div>
                )}
            </div>
        </>
    );
}

export default ComponentScale;
