# SYNC-SETUP.md

## Step-by-Step Instructions for Cross-Device Sync

1. **Prerequisites**  
   Ensure you have the following installed:  
   - [Git](https://git-scm.com/)  
   - [Node.js](https://nodejs.org/)  
   - Any relevant dependencies according to the project documentation.

2. **Clone the Repository**  
   Open your terminal and run:  
   ```bash  
   git clone https://github.com/hamzasaleem021/open-loops.git  
   cd open-loops  
   ```

3. **Set Up Environment Variables**  
   Create a `.env` file in the root of the project and add the necessary environment variables:
   ```plaintext  
   ENV_VAR_NAME=value  
   ANOTHER_VAR_NAME=value  
   ```  
   Replace `ENV_VAR_NAME` with your actual environment variable names and values.

4. **Secure Your Environment**  
   - Do not share your `.env` file publicly.  
   - Use a password manager to store sensitive information.  
   - Regularly update your dependencies and review permission settings.

5. **Run the Application**  
   After setting up the environment variables, you can run the application with:
   ```bash  
   npm start  
   ```

## Troubleshooting Guide

- If you encounter issues, check the following:  
  - Ensure all dependencies are installed properly by running:
    ```bash  
    npm install  
    ```  
  - Verify that the environment variables are correctly set up.  
  - Check for any console errors and refer to the logs for more information.
  - If the sync doesn't work, try looking at the configuration files and ensure they match the expected format.

If you continue to have problems, consult the [issues](https://github.com/hamzasaleem021/open-loops/issues) on GitHub or reach out for further assistance.