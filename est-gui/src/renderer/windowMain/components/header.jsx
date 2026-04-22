function ComponentHeader({ headline }) {
    return (
        <>
            <div className="mb-8 flex-none border-b border-gray-700 pb-4">
                <h1 className="text-left text-4xl font-semibold text-gray-700">{headline}</h1>
            </div>
        </>
    );
}

export default ComponentHeader;
