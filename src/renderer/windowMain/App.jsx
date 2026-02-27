import SectionBody from "./components/l0_SectionBody";
import SectionHeader from "./components/l0_SectionHeader";
import SectionVersions from "./components/l0_SectionAbout";

function App() {
    return (
        <>
            <div className="flex h-screen flex-col justify-between">
                <SectionHeader></SectionHeader>
                <SectionBody></SectionBody>
                <SectionVersions></SectionVersions>
            </div>
        </>
    );
}

export default App;
