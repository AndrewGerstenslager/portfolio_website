document.addEventListener('DOMContentLoaded', function () {
    var coll = document.getElementsByClassName("collapsible");
    var i;
  
    for (i = 0; i < coll.length; i++) {
        coll[i].addEventListener("click", function() {
            this.classList.toggle("active");
            var content = this.nextElementSibling;
            var indicator = this.querySelector('.indicator');
            
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
                indicator.textContent = '+'; // Change to '+' when collapsed
            } else {
                content.style.maxHeight = content.scrollHeight + "px";
                indicator.textContent = '-'; // Change to '-' when expanded
            }
        });
    }
  });
  