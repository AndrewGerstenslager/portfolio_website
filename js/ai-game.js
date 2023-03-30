document.addEventListener("DOMContentLoaded", function () {
const cells = document.querySelectorAll(".cell");
const restartBtn = document.querySelector("#restartBtn");
const aiSelect = document.querySelector("#aiSelect");
let currentPlayer = "x";
let isGameOver = false;
let lastPlayerMove = null;
let acceptingInput = true;


function getCellState(cell) {
  if (cell.classList.contains("x")) {
    return "x";
  } else if (cell.classList.contains("o")) {
    return "o";
  } else {
    return "blank";
  }
}


function checkWin() {
  //Compares the win state for rows, columns, and diagonals
  const winPatterns = [
    // Rows
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    // Columns
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    // Diagonals
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (
      cells[a].classList.contains(currentPlayer) &&
      cells[b].classList.contains(currentPlayer) &&
      cells[c].classList.contains(currentPlayer)
    ) {
      return true;
    }
  }
  return false;
}


function checkDraw() {
  //Returns draw if all moves are taken
  return [...cells].every(cell => cell.classList.contains("x") || cell.classList.contains("o"));
}

function randomMove() {
  const availableCells = [...cells].filter(cell => !cell.classList.contains('x') && !cell.classList.contains('o'));
  if (availableCells.length === 0) return;
  const randomCell = availableCells[Math.floor(Math.random() * availableCells.length)];
  randomCell.textContent = currentPlayer;
  randomCell.classList.add(currentPlayer);
}

function blockingMove() {
  let moveFound = false;
  
  //CHECK IMMEDIATE LOSS
  const winPatterns = [
    // Rows
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    // Columns
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    // Diagonals
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    const cellStates = [getCellState(cells[a]), 
                        getCellState(cells[b]),
                        getCellState(cells[c])];

    if (cellStates.filter(state => state === 'x').length === 2 && cellStates.includes('blank')) {
      const emptyIndex = cellStates.indexOf('blank');
      const blockingCell = cells[pattern[emptyIndex]];
      blockingCell.textContent = currentPlayer;
      blockingCell.classList.add(currentPlayer);
      moveFound = true;
      break;
    }
  }

  if (moveFound) { return; }

  //CHECK TO PLACE ON OPPOSITE CORNER
  if (!(8- lastPlayerMove == 4) && 
      !(getCellState(cells[8-lastPlayerMove]).state == "x") && 
      !(getCellState(cells[8-lastPlayerMove]).state == "o")){
    
    const blockingCell = cells[8-lastPlayerMove];
    blockingCell.textContent = currentPlayer;
    blockingCell.classList.add(currentPlayer);
    moveFound = true;
  }

  //ELSE PICK RANDOM
  if (!moveFound) {
    randomMove();
  }
}

function minMaxMove(){

}

function neuralNetMove(){

}

function makeAiMove() {
  // Get the selected AI
  const selectedAi = aiSelect.value;

  // Call the appropriate AI function based on the selected value
  if (selectedAi === 'ai1') { randomMove();} 
  else if (selectedAi === 'ai2') { blockingMove(); } 
  else if (selectedAi === 'ai3') { minMaxMove(); } 
  else if (selectedAi === 'ai4') { neuralNetMove(); } 
  else { randomMove(); }
}


function handleMove(e) {
  if (isGameOver) return;
  if (e.target.classList.contains("x") || e.target.classList.contains("o")) return;
  
  e.target.textContent = currentPlayer;
  e.target.classList.add(currentPlayer);
  lastPlayerMove = Array.from(cells).indexOf(e.target);
  
  //CHECK WIN
  if (checkWin()) {
    setTimeout(() => {
      alert(`${currentPlayer.toUpperCase()} wins!`);
      isGameOver = true;
    }, 50);
  } 
  
  //CHECK DRAW
  else if (checkDraw()) {
    setTimeout(() => {
      alert("It's a draw!");
      isGameOver = true;
    }, 50);
  } 

  //OPPONENT MOVES
  else {
    currentPlayer = currentPlayer === "x" ? "o" : "x";
    makeAiMove();
    
    if (checkWin()) {
      setTimeout(() => {
        alert(`${currentPlayer.toUpperCase()} wins!`);
        isGameOver = true;
      }, 50);
    } else if (checkDraw()) {
      setTimeout(() => {
        alert("It's a draw!");
        isGameOver = true;
      }, 50);
    } else {
      currentPlayer = currentPlayer === "x" ? "o" : "x";
    }
  }
}


function restartGame() {
  cells.forEach(cell => {
    cell.textContent = "";
    cell.classList.remove("x", "o");
  });
  currentPlayer = "x";
  isGameOver = false;
}

cells.forEach(cell => cell.addEventListener("click", handleMove));
//Adds the handleMove event on click on any board cell
restartBtn.addEventListener("click", restartGame);
//Adds reset button functionality
});