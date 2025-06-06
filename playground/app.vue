<template>
  <div>
    Nuxt module playground!
    <button @click="fetchTestEndpoint">Fetch Test Endpoint</button>
  </div>
</template>

<script setup>
function fetchTestEndpoint() {
  fetch('/api/test')
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error fetching test endpoint:', error));
}
</script>
