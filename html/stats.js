$(document).ready(function() {
    $.getJSON('/api/stats', function(data) {
        $('#levelcount').text(data.levelcount);
        $('#usercount').text(data.usercount);
    });
});