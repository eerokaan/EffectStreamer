function ComponentHeader({headline}) {
    return (
        <>
            <div className="flex-none border-b border-gray-700 mb-8 pb-4">
                <h1 className="text-4xl font-semibold text-left text-gray-700">{headline}</h1>
            </div>
        </>
    );
}

export default ComponentHeader;
