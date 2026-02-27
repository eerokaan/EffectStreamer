function SectionHeader() {
    const { displayName } = window.appInfo;

    return (
        <>
            <div className="border-b border-slate-300 bg-gray-50 p-4">
                <h1 className="text-center text-2xl leading-none font-bold">{displayName}</h1>
            </div>
        </>
    );
}

export default SectionHeader;
