$(document).ready(function(){
    // Mobile menu toggle with sliding effect
    $("#mobile-menu").click(function(){
        $(".nav-list").slideToggle();
    });

    // Function to check if an element is in view
    function isScrolledIntoView(elem) {
        var docViewTop = $(window).scrollTop();
        var docViewBottom = docViewTop + $(window).height();

        var elemTop = $(elem).offset().top;
        var elemBottom = elemTop + $(elem).height();

        return ((elemBottom <= docViewBottom) && (elemTop >= docViewTop));
    }

    // Animate elements when they are in view
    function animateElements() {
        $('.animated-element').each(function() {
            if (isScrolledIntoView(this) === true) {
                $(this).addClass('animated-element-in-view');
            }
        });
    }

    // Initial call
    animateElements();

    // Bind the animation function to the scroll event
    $(window).scroll(function() {
        animateElements();
    });
});
