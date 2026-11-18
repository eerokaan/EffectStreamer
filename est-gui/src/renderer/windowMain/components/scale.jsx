import { useRef } from "react";
import useStoreComponentScale from "@/stores/component-scale";
import { resolveLocalizedImage } from "@/lib/helper-assets";
import { useSessionLanguage, useTranslate } from "@/lib/helper-languages";

const imageWidth = 4200;
const imageHeight = 575;
const fixedY = 115;

const scaleClasses = {
    class01: { xMin: 223, xMax: 3971 },
    class02: { xMin: 102, xMax: 4090 }
};

const scales = {
    audio_quality: { scaleClass: "class01", image: "01_audio_quality.png" },
    coloration: { scaleClass: "class02", image: "02_coloration.png" },
    discontinuity: { scaleClass: "class02", image: "03_discontinuity.png" },
    degradation: { scaleClass: "class02", image: "04_degradation.png" },
    echo: { scaleClass: "class02", image: "05_echo.png" },
    interaction: { scaleClass: "class02", image: "06_interaction.png" },
    loudness: { scaleClass: "class02", image: "07_loudness.png" },
    noisiness: { scaleClass: "class02", image: "08_noisiness.png" }
};

function ComponentScale({ scaleName }) {
    const { scaleValues, setScaleValues } = useStoreComponentScale();
    const language = useSessionLanguage();
    const __ = useTranslate();
    const imgReference = useRef(null);

    const scaleInfo = scales[scaleName];
    const { xMin, xMax } = scaleClasses[scaleInfo.scaleClass];
    const image = resolveLocalizedImage("scales", scaleInfo.image, language);

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
                <img ref={imgReference} src={image} alt={__("Rating scale")} data-rating-scale={scaleName} className="block w-full" draggable="false" />
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
