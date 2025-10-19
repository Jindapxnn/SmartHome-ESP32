# 💡Smart Home IoT LED Controller (ESP32 + AWS Serverless)

This project demonstrates a secure, high-efficiency 3-Tier IoT architecture using ESP32 (MQTT/TLS) to control an LED via a Static Web Application (S3). The setup utilizes AWS API Gateway and AWS Lambda as the primary protocol conversion layer (HTTP → MQTT).

## 🛠️ Developer Setup & Deployment

#### 1. AWS Cloud Prerequisites

- You must set up the necessary AWS infrastructure. This process should ideally be automated using Terraform.

- Lambda Function: Node.js Runtime with an Execution IAM Role granted `iot:Publish` access to the control topic `(arn:aws:iot:REGION:ACCOUNT_ID:topic/smarthome/*/led/control)`.

- API Gateway: A REST API with a `POST` method integrated with the Lambda Function `(must use Lambda Proxy Integration)`.

- S3 Bucket: Configured for Static Website Hosting, with a CORS Policy allowing `GET` and `POST` requests.

#### 2. ESP32 Firmware Configuration (`firmware/ `)

This involves setting up the device's unique credentials and flashing the firmware.

Preparing the Secrets File

The following step must be done before compiling the firmware:

```bash
# 1. Create the secrets file template
$ cp secrets_template.h firmwares/secrets.h

# 2. Open firmwares/secrets.h and populate the following values:
    - WIFI_SSID and WIFI_PASSWORD
    - AWS_IOT_ENDPOINT
    - AWS_CERT_CA, AWS_CERT_CRT, and AWS_CERT_PRIVATE
```

#### 3. Web Application Deployment (`web-app/ `)

The web application needs to be configured with the correct API endpoint and deployed to the S3 bucket.

#### Configuring the API Endpoint

Update the app.js file with your deployed endpoint URL:

```bash
// Open web-app/app.js and replace the placeholder URL:
const API_GATEWAY_URL = "YOUR_API_GATEWAY_INVOKE_URL_HERE";
```

#### Deploying to S3

Upload the frontend files to your bucket (replace YOUR_BUCKET_NAME with your S3 bucket name):

```bash
# Upload HTML and JavaScript files to the S3 root
$ aws s3 cp web-app/index.html s3://YOUR_BUCKET_NAME/index.html --content-type text/html
$ aws s3 cp web-app/app.js s3://YOUR_BUCKET_NAME/app.js --content-type application/javascript
```

## ✅ Testing & Verification

To verify the end-to-end functionality, perform the following tests:

#### Test Lambda Execution

Run a simulated test event from the AWS Lambda console to check the MQTT publication logic.

```bash
# The simulated payload structure must match the API Gateway format:
$ Payload body: {"state": "on"}

# Verify Logs: The Lambda logs should show "Successfully published..."
```

#### Test Web Application

Access your S3 Website Endpoint URL and test the buttons:

```bash
# Access the deployed website URL
$ open [S3 Website Endpoint URL]

# Actions: Click ON/OFF buttons
# Verification: The LED on the ESP32 should respond, and the web status should change to "Success".
```