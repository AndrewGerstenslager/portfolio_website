//-------------------
// GLOBAL variables
//-------------------
let model;
var canvasWidth = 250;
var canvasHeight = 250;
var canvasStrokeStyle = "white";
var canvasLineJoin = "round";
var canvasLineWidth = 15;
var canvasBackgroundColor = "black";
var canvasId = "canvas";

var clickX = new Array();
var clickY = new Array();
var clickD = new Array();
var drawing;

document.getElementById('chart_box').innerHTML = "";
document.getElementById('chart_box').style.display = "none";

//---------------
// Create canvas
//---------------
var canvasBox = document.getElementById('canvas_box');
var canvas = document.createElement("canvas");

canvas.setAttribute("width", canvasWidth);
canvas.setAttribute("height", canvasHeight);
canvas.setAttribute("id", canvasId);
canvas.style.backgroundColor = canvasBackgroundColor;
canvasBox.appendChild(canvas);
if (typeof G_vmlCanvasManager != 'undefined') {
    canvas = G_vmlCanvasManager.initElement(canvas);
}

var ctx = canvas.getContext("2d");

// Corrected event listeners for mouse and touch events
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('touchstart', startDrawing, { passive: false });

canvas.addEventListener('mousemove', draw);
canvas.addEventListener('touchmove', draw, { passive: false });

canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);
canvas.addEventListener('touchend', stopDrawing);

function getMousePos(canvasDom, mouseEvent) {
    var rect = canvasDom.getBoundingClientRect();
    return {
        x: mouseEvent.clientX - rect.left,
        y: mouseEvent.clientY - rect.top
    };
}

function getTouchPos(canvasDom, touchEvent) {
    var rect = canvasDom.getBoundingClientRect();
    return {
        x: touchEvent.touches[0].clientX - rect.left,
        y: touchEvent.touches[0].clientY - rect.top
    };
}

function startDrawing(event) {
    drawing = true;
    var pos = (event.type === 'touchstart') ? getTouchPos(canvas, event) : getMousePos(canvas, event);
    addUserGesture(pos.x, pos.y);
    drawOnCanvas();
    if (event.type.startsWith('touch')) {
        event.preventDefault();
    }
}

function draw(event) {
    if (!drawing) return;
    var pos = (event.type === 'touchmove') ? getTouchPos(canvas, event) : getMousePos(canvas, event);
    addUserGesture(pos.x, pos.y, true);
    drawOnCanvas();
    if (event.type.startsWith('touch')) {
        event.preventDefault();
    }
}

// Stop Drawing
function stopDrawing(event) {
    if (!drawing) return;
    drawing = false;
    if (event.type === 'mouseup' || event.type === 'mouseleave') {
        performPrediction();
    } else if (event.type === 'touchend') {
        performPrediction();
    }
}

// Perform Prediction
function performPrediction() {
    // Prediction logic moved here
    var imageData = canvas.toDataURL();
    let tensor = preprocessCanvas(canvas);
    model.predict(tensor).data().then(function(predictions) {
        let results = Array.from(predictions);
        displayChart(results);
        displayLabel(results);
        console.log(results);
    });
}

// Add User Gesture
function addUserGesture(x, y, dragging) {
    clickX.push(x);
    clickY.push(y);
    clickD.push(dragging);
}

// Draw on Canvas
function drawOnCanvas() {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = canvasStrokeStyle;
    ctx.lineJoin = canvasLineJoin;
    ctx.lineWidth = canvasLineWidth;

    for (var i = 0; i < clickX.length; i++) {
        ctx.beginPath();
        if (clickD[i] && i) {
            ctx.moveTo(clickX[i - 1], clickY[i - 1]);
        } else {
            ctx.moveTo(clickX[i] - 1, clickY[i]);
        }
        ctx.lineTo(clickX[i], clickY[i]);
        ctx.closePath();
        ctx.stroke();
    }
}

// Clear Canvas
$("#clear-button").click(function () {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    clickX = [];
    clickY = [];
    clickD = [];
    $(".prediction-text").empty();
    // Reset chart data
    if (chart) {
        chart.data.datasets.forEach((dataset) => {
            dataset.data = Array(chart.data.labels.length).fill(0);
        });
        chart.update();
    }
});

// Load Model
async function loadModel() {
    console.log("model loading..");
    model = undefined;
    model = await tf.loadLayersModel("files/model.json");
    console.log("model loaded..");
    loadChart(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], Array(10).fill(0), "CNN");
    displayChart(Array(10).fill(0));
}

// Preprocess Canvas
function preprocessCanvas(image) {
    let tensor = tf.browser.fromPixels(image)
        .resizeNearestNeighbor([28, 28])
        .mean(2)
        .expandDims(2)
        .expandDims()
        .toFloat();
    console.log(tensor.shape);
    return tensor.div(255.0);
}

// Chart to Display Predictions
var chart = "";
function loadChart(label, data, modelSelected) {
    var ctx = document.getElementById('chart_box').getContext('2d');
    if (chart) {
        chart.destroy();
    }
    chart = new Chart(ctx, {
        // Chart configuration...
    });
}


//----------------------------
// display chart with updated
// drawing from canvas
//----------------------------
function displayChart(data) {
    var ctx = document.getElementById('chart_box').getContext('2d');
    if (chart) {
        chart.destroy(); // Destroy the existing chart instance before creating a new one
    }
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], // The labels for each bar
            datasets: [{
                label: "CNN prediction",
                backgroundColor: '#744167',
                borderColor: 'rgb(255, 99, 132)',
                data: data, // The data array from your prediction results
            }]
        },
        options: {
            animation: {
                duration: 1000, // Duration of the animation in milliseconds
                easing: 'easeOutBounce', // The easing function of the animation
                onComplete: function () {
                    console.log('Animation completed!');
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }

            },
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Make the chart container visible
    document.getElementById('chart_box').style.display = 'block';
}


function displayLabel(data) {
    var max = data[0];
    var maxIndex = 0;

    for (var i = 1; i < data.length; i++) {
        if (data[i] > max) {
            maxIndex = i;
            max = data[i];
        }
    }
    $(".prediction-text").html("Predicting you draw <b>" + maxIndex + "</b> with <b>" + Math.trunc(max * 100) + "%</b> confidence")
}

// Function to set canvas size based on screen width
function setCanvasSize() {
    if (window.innerWidth > 600) { // Adjust this value based on your needs
        canvasWidth = 400;
        canvasHeight = 400;
    } else {
        canvasWidth = 240; // Default size for narrow screens
        canvasHeight = 240;
    }
    canvas.setAttribute("width", canvasWidth);
    canvas.setAttribute("height", canvasHeight);
}

// Call setCanvasSize on window load and resize
window.onload = setCanvasSize;
window.onresize = setCanvasSize;



loadModel();
