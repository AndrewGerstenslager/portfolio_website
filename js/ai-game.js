document.addEventListener("DOMContentLoaded", function () {
    const cells = document.querySelectorAll(".cell");
    const restartBtn = document.querySelector("#restartBtn");
    const aiSelect = document.querySelector("#aiSelect");
    let currentPlayer = "x";
    let isGameOver = false;
  
    function checkWin() {
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
      return [...cells].every(cell => cell.classList.contains("x") || cell.classList.contains("o"));
    }
  
    function makeMove(e) {
      if (isGameOver) return;
      if (e.target.classList.contains("x") || e.target.classList.contains("o")) return;
      e.target.textContent = currentPlayer;
      e.target.classList.add(currentPlayer);
  
      if (checkWin()) {
        alert(`${currentPlayer.toUpperCase()} wins!`);
        isGameOver = true;
      } else if (checkDraw()) {
        alert("It's a draw!");
        isGameOver = true;
      } else {
        currentPlayer = currentPlayer === "x" ? "o" : "x";
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
  
    cells.forEach(cell => cell.addEventListener("click", makeMove));
    restartBtn.addEventListener("click", restartGame);
});