function SectionAbout() {
    const { displayName, version, company } = window.appInfo;

    return (
        <>
            <div className="flex flex-col border-t border-slate-300 bg-gray-50 p-4 leading-5">
                <span className="text-sm not-italic">
                    {displayName} v{version}
                </span>
                <span className="text-xs text-slate-600 italic">{company}</span>
            </div>
        </>
    );
}

export default SectionAbout;
