let model;
let canvas;
let ctx;
let coord = { x: 0, y: 0 };
let paint = false;

function getPosition(event) {
    coord.x = event.clientX - canvas.getBoundingClientRect().left;
    coord.y = event.clientY - canvas.getBoundingClientRect().top;
}

function resizeCanvas() {
    // Set a specific size for the canvas
    canvas.width = 256;
    canvas.height = 256;
}

function startPainting(event) {
    paint = true;
    getPosition(event);
}

function stopPainting() {
    paint = false;
}

function sketch(event) {
    if (!paint) return;
    ctx.beginPath();
    
    // Adjust lineWidth to cover the canvas sufficiently for a 28x28 pixel image
    ctx.lineWidth = canvas.width / 20;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'black';
    
    ctx.moveTo(coord.x, coord.y);
    getPosition(event);
    ctx.lineTo(coord.x, coord.y);
    ctx.stroke();
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function logPrediction() {
      
    // Create a temporary canvas to resize the image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 28;
    tempCanvas.height = 28;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw the image into the temporary canvas, resizing it in the process
    tempCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 28, 28);

    // Get the image data from the temporary canvas
    const resizedImageData = tempCtx.getImageData(0, 0, 28, 28);

    // Darken non-zero pixels
    for (let i = 0; i < resizedImageData.data.length; i += 4) {
        // Check if the pixel is not white (assuming the drawing is black on white)
        if (resizedImageData.data[i] < 255 || resizedImageData.data[i + 1] < 255 || resizedImageData.data[i + 2] < 255) {
            // Reduce the RGB values to darken the pixel; the alpha channel is at i+3 and should be left as is
            resizedImageData.data[i] *= 0.7; // R
            resizedImageData.data[i + 1] *= 0.7; // G
            resizedImageData.data[i + 2] *= 0.7; // B
        }
    }

    // Draw the darkened image onto the preview canvas for visualization
    const previewCanvas = document.getElementById('previewCanvas');
    const previewCtx = previewCanvas.getContext('2d');

    // Clear previous preview
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    // Put the darkened image data into the preview canvas
    previewCtx.putImageData(resizedImageData, 0, 0);

    // Get the image data from the original canvas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
    // Convert the ImageData to a tensor
    const inputTensor = tf
    
    // Log the inputTensor data for debugging
    let inputTensorData = await inputTensor.data();
    console.log('Input Tensor Data:', Array.from(inputTensorData));

    // Normalize the tensor to have values between 0 and 1
    const normalizedTensor = inputTensor.toFloat().div(tf.scalar(255));
    
    // Log the normalizedTensor data for debugging
    let normalizedTensorData = await normalizedTensor.data();
    console.log('Normalized Tensor Data:', Array.from(normalizedTensorData));

    // Add a batch dimension with `expandDims` because the model expects a 4D tensor
    const batchedTensor = normalizedTensor.expandDims(0);

    // Now you can pass the tensor into your model
    const prediction = await model.predict(batchedTensor);

    // Get the data from the tensor
    const predictionData = await prediction.data();

    // Log the prediction data to the console
    console.log('Prediction Data:', predictionData);

    // Dispose of the tensors to free up GPU memory
    inputTensor.dispose();
    normalizedTensor.dispose();
    batchedTensor.dispose();
}




async function loadModel() {
    // Load the model from the correct path
    model = await tf.loadLayersModel('files/model.json');
    console.log('Model loaded successfully');
}

// Ensure the DOM is fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();

    document.getElementById('clear-button').addEventListener('click', clearCanvas);
    document.getElementById('predict-button').addEventListener('click', logPrediction);
    canvas.addEventListener('mousedown', startPainting);
    canvas.addEventListener('mouseup', stopPainting);
    canvas.addEventListener('mousemove', sketch);

    loadModel(); // Load the TensorFlow.js model
});
