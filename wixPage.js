// API Reference: https://www.wix.com/velo/reference/api-overview/introduction
// “Hello, World!” Example: https://learn-code.wix.com/en/article/hello-world
import wixLocation from 'wix-location';

$w.onReady(function () {
  // Get the url from the event and redirect to the url
  $w('#html1').onMessage((event) => {
    wixLocation.to(event.data);
  });
});
