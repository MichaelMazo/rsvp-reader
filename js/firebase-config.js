/**
 * Firebase configuration and initialization
 */
const firebaseConfig = {
    apiKey: "AIzaSyDclpxuiVaZMWs6iLdiEQ4Vz8xSJ0qHG8w",
    authDomain: "rsvp-reader-478b0.firebaseapp.com",
    projectId: "rsvp-reader-478b0",
    storageBucket: "rsvp-reader-478b0.firebasestorage.app",
    messagingSenderId: "275087337756",
    appId: "1:275087337756:web:e117ba24e27fd1290f72d9"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get references to services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
