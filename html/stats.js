$(document).ready(function() {
    $.getJSON('/api/stats', function(data) {
        $('#levelcount').text(data.levelcount);
        $('#usercount').text(data.usercount);
    });
    $.get('/api/curcommit', function(data) {
        const hash = data.hash;
        const remote = data.remote;
        let baseUrl = remote;
        if (remote.startsWith('git@')) {
            // Convert SSH to HTTPS
            baseUrl = remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
        } else {
            baseUrl = remote.replace(/\.git$/, '');
        }
        const commitUrl = `${baseUrl}/commit/${hash}`;
        $('#commit').html(`@ <a href="${commitUrl}" target="_blank">${hash}</a>`);
    });
});