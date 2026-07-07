function createShuffledIndices(length) {
    const indices = [];

    for (let counter = 0; counter < length; counter++) {
        const swapIndex = Math.floor(Math.random() * (counter + 1));
        indices[counter] = indices[swapIndex];
        indices[swapIndex] = counter;
    }

    return indices;
}

module.exports = { createShuffledIndices };
