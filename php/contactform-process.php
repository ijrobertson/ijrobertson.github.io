<?php
$errorMSG = "";

error_reporting(E_ALL);

if (empty($_POST["name"])) {
    $errorMSG = "Name is required ";
} else {
    $name = $_POST["name"];
}

if (empty($_POST["email"])) {
    $errorMSG = "Email is required ";
} else {
    $email = $_POST["email"];
}

if (empty($_POST["message"])) {
    $errorMSG = "Message is required ";
} else {
    $message = $_POST["message"];
}

if (empty($_POST["terms"])) {
    $errorMSG = "Terms is required ";
} else {
    $terms = $_POST["terms"];
}

$EmailTo = 'ianjack1643@gmail.com';
$Subject = "New message from Lingua Bud landing page";
$headers = "From: Your Name <ianjack1643@gmail.com.com>\r\n";
$headers .= "Reply-To: Ianjack1643@gmail.com.com\r\n";
$headers .= "Content-Type: text/plain; charset=utf-8\r\n";

// send email
$success = mail($EmailTo, $Subject, $Body, $headers);


// prepare email body text
$Body = "";
$Body .= "Name: ";
$Body .= $name;
$Body .= "\n";
$Body .= "Email: ";
$Body .= $email;
$Body .= "\n";
$Body .= "Message: ";
$Body .= $message;
$Body .= "\n";
$Body .= "Terms: ";
$Body .= $terms;
$Body .= "\n";

// send email
$success = mail($EmailTo, $Subject, $Body, $headers,'From: admin@linguabud.com');

// redirect to success page
if ($success && $errorMSG == ""){
   echo "success";
}else{
    if($errorMSG == ""){
        echo "Something went wrong :(";
    } else {
        echo $errorMSG;
    }
}
?>
