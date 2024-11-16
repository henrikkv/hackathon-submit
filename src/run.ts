import dotenv from 'dotenv';
// Load environment variables at the very beginning
dotenv.config();

import { runAloria, configureAloria } from 'aloria';
import { chromium } from 'playwright';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import OpenAI from 'openai';
import { simpleGit } from 'simple-git';
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';

async function generateReadme(repoUrl: string): Promise<{
  projectName: string;
  briefDescription: string;
  readme: string;
  detailedDescription: string;
}> {
  // Initialize clients
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Clone the repository
  const tempDir = await cloneRepository(repoUrl);

  // Generate code summaries
  const codeSummary = readDirectory(tempDir);

  // Clean up the cloned repository
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Generate README and detailed description using OpenAI
  const { projectName, briefDescription, readme } = await createReadme(
    openai,
    codeSummary
  );
  const detailedDescription = await createDetailedDescription(
    openai,
    codeSummary
  );

  return {
    projectName,
    briefDescription,
    readme,
    detailedDescription,
  };
}

// Helper function to clone the repository
async function cloneRepository(repoUrl: string): Promise<string> {
  const tempDir = path.join(__dirname, 'temp_repo');
  const git = simpleGit();
  try {
    await git.clone(repoUrl, tempDir);
    return tempDir;
  } catch (error) {
    console.error('Error cloning repository:', error);
    throw error;
  }
}

// Helper function to read directory and summarize files
function readDirectory(dir: string): string {
  let content = '';
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.lstatSync(filePath);
    if (stat.isDirectory()) {
      content += readDirectory(filePath);
    } else if (
      file.endsWith('.js') ||
      file.endsWith('.ts') ||
      file.endsWith('.py') ||
      file.endsWith('.java') ||
      file.endsWith('.md')
    ) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const fileSummary = summarizeFile(fileContent, file);
        content += `\n\n---\n**File:** ${filePath.replace(
          dir,
          ''
        )}\n${fileSummary}\n`;
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        continue;
      }
    }
  }
  return content;
}

// Helper function to summarize individual files
function summarizeFile(content: string, filename: string): string {
  let summary = '';

  if (filename.endsWith('.js') || filename.endsWith('.ts')) {
    // Parse JavaScript/TypeScript files
    try {
      const ast = parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      const imports: string[] = [];
      const exports: string[] = [];
      const classes: string[] = [];
      const functions: string[] = [];

      ast.program.body.forEach((node) => {
        switch (node.type) {
          case 'ImportDeclaration':
            imports.push(node.source.value);
            break;
          case 'ExportNamedDeclaration':
          case 'ExportDefaultDeclaration':
            exports.push(node.type);
            break;
          case 'ClassDeclaration':
            if (node.id) {
              classes.push(node.id.name);
            }
            break;
          case 'FunctionDeclaration':
            if (node.id) {
              functions.push(node.id.name);
            }
            break;
        }
      });

      summary += `- **Imports:** ${imports.join(', ')}\n`;
      summary += `- **Exports:** ${exports.join(', ')}\n`;
      summary += `- **Classes:** ${classes.join(', ')}\n`;
      summary += `- **Functions:** ${functions.join(', ')}\n`;
    } catch (error) {
      console.error(`Error parsing file ${filename}:`, error);
    }
  } else if (filename.endsWith('.py')) {
    // Implement similar logic for Python files (omitted for brevity)
  } else if (filename.endsWith('.md')) {
    // Include the first few lines of Markdown files
    const lines = content.split('\n').slice(0, 5).join('\n');
    summary += `- **Content Preview:**\n${lines}\n`;
  } else {
    summary += `- **Summary:** Not available for this file type.\n`;
  }

  return summary;
}

// Helper function to create README using OpenAI
async function createReadme(
  openai: OpenAI,
  codeSummary: string
): Promise<{ projectName: string; briefDescription: string; readme: string }> {
  try {
    const readmeResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: "system",
          content: "You are an assistant that writes detailed README files for GitHub repositories based on their codebase summaries. Output all your responses in valid JSON format.",
        },
        {
          role: 'user',
          content: `Based on the following codebase summary, generate a comprehensive README file for the repository. Additionally, provide the project's name and a brief description. Your response should be in the following JSON format without any additional text:

\`\`\`json
{
  "projectName": "<project name>",
  "briefDescription": "<brief description>",
  "readmeContent": "<full README content>"
}
\`\`\`

Codebase summary:
${codeSummary}`,
        },
      ],
    });

    const responseContent = readmeResponse.choices[0].message?.content || '';

    // Use a regular expression to extract JSON
    const jsonMatch = responseContent.match(/{[\s\S]*}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in the response');
    }

    let jsonString = jsonMatch[0];

    // Sanitize the JSON string by escaping control characters
    jsonString = jsonString.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

    // Parse the JSON
    const data = JSON.parse(jsonString);

    return {
      projectName: data.projectName.trim(),
      briefDescription: data.briefDescription.trim(),
      readme: data.readmeContent.trim(),
    };
  } catch (error) {
    console.error('Error generating README:', error);
    throw new Error('Failed to parse JSON from OpenAI response');
  }
}

// Helper function to create detailed description using OpenAI
async function createDetailedDescription(
  openai: OpenAI,
  codeSummary: string
): Promise<string> {
  try {
    const descriptionResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that provides detailed descriptions of applications based on their codebase summaries.',
        },
        {
          role: 'user',
          content: `Based on the following codebase summary, provide a very detailed description of the full application:

Codebase summary:
${codeSummary}`,
        },
      ],
    });

    return (
      descriptionResponse.choices[0].message?.content ||
      'No detailed description generated'
    );
  } catch (error) {
    console.error('Error generating detailed description:', error);
    throw error;
  }
}

// Helper function to create a concise prompt for image generation
function createImagePrompt(description: string): string {
  // Split into sentences and take first few
  const sentences = description.split(/[.!?]+/).filter(Boolean);
  const shortDescription = sentences.slice(0, 3).join('. ');
  
  // Create a focused prompt
  return `User interface screenshot of a web application: ${shortDescription.slice(0, 950)}`.trim();
}
async function fetchAndSaveImage(imageUrl: string, savePath: string): Promise<void> {
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(savePath, buffer);
}
async function generateImages(openai: OpenAI, description: string): Promise<{ logoPath: string, coverPath: string }> {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const logoPrompt = createImagePrompt(description) + " Logo";
      const coverPrompt = createImagePrompt(description) + " Cover image";

      const [logoResponse, coverResponse] = await Promise.all([
        openai.images.generate({
          prompt: logoPrompt,
          n: 1,
          size: '1024x1024',
        }),
        openai.images.generate({
          prompt: coverPrompt,
          n: 1,
          size: '1024x1024',
        }),
      ]);

      // Save images to disk
      const logoUrl = logoResponse.data[0].url;
      const coverUrl = coverResponse.data[0].url;

      const logoPath = path.join(__dirname, 'logo.png');
      const coverPath = path.join(__dirname, 'cover.png');

      if (logoUrl && coverUrl) {
        await Promise.all([
          fetchAndSaveImage(logoUrl, logoPath),
          fetchAndSaveImage(coverUrl, coverPath),
        ]);
      } else {
        throw new Error('Logo or cover URL is undefined');
      }

      return {
        logoPath,
        coverPath,
      };
    } catch (error) {
      console.error('Error generating images:', error);
      if ((error as any).response && (error as any).response.status === 429) {
        // Rate limit error
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`Rate limited. Retrying in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Failed to generate images after multiple attempts');
}
async function generateScreenshots(openai: OpenAI, description: string, count: number): Promise<string[]> {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const screenshotPrompt = createImagePrompt(description) + " Screenshot";

      const screenshotResponse = await openai.images.generate({
        prompt: screenshotPrompt,
        n: count,
        size: '1024x1024',
      });

      const screenshotPaths: string[] = [];

      for (let i = 0; i < count; i++) {
        const screenshotUrl = screenshotResponse.data[i]?.url;
        if (screenshotUrl) {
          const screenshotPath = path.join(__dirname, `screenshot${i + 1}.png`);
          await fetchAndSaveImage(screenshotUrl, screenshotPath);
          screenshotPaths.push(screenshotPath);
        } else {
          console.error(`Screenshot URL not found for index ${i}`);
        }
      }

      return screenshotPaths;
    } catch (error) {
      console.error('Error generating screenshots:', error as Error);
      if ((error as any).response && (error as any).response.status === 429) {
        // Rate limit error
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`Rate limited. Retrying in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Failed to generate screenshots after multiple attempts');
}
async function uploadImage(page: any, imageSource: string, fileInputId: string, isFilePath: boolean = false) {
  let filePath = '';

  if (isFilePath) {
    // Use the provided file path
    filePath = imageSource;
  } else {
    // Fetch the image from the URL and save it temporarily
    const response = await fetch(imageSource);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    filePath = path.join(__dirname, 'temp_image.png');
    fs.writeFileSync(filePath, buffer);
  }

  // Directly set the input files without waiting for visibility
  await page.setInputFiles(`#${fileInputId}`, filePath);

  if (!isFilePath) {
    // Remove the temporary file
    fs.unlinkSync(filePath);
  }
}


async function main() {
    const shouldGenerateImages = false;
  // Configure Aloria with environment variable
  configureAloria({
    apiKey: process.env.ALORIA_API_KEY,
  });

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Get the base URL from command-line arguments
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('Please provide a base URL as a command-line argument.');
    process.exit(1);
  }

  // Combine the base URL with the specific path
  const fullUrl = `${baseUrl}/events/bangkok/project`;
  await page.goto(fullUrl);

  // Generate README and extract project details
  const {
    projectName,
    briefDescription,
    readme,
    detailedDescription,
  } = await generateReadme('https://github.com/henrikkv/hackathon-submit');

  console.log('Project Name:', projectName);
  console.log('Brief Description:', briefDescription);
  console.log('\nGenerated README:\n');
  console.log(readme);
  console.log('\nDetailed Description:\n');
  console.log(detailedDescription);

  let logoPath: string;
  let coverPath: string;
  let screenshotPaths: string[] = [];

  if (shouldGenerateImages) {
    // Generate images and save them to disk
    const imagePaths = await generateImages(openai, detailedDescription);
    logoPath = imagePaths.logoPath;
    coverPath = imagePaths.coverPath;

    // Generate screenshots
    const screenshotCount = 5;
    screenshotPaths = await generateScreenshots(openai, detailedDescription, screenshotCount);
  } else {
    // Load images from disk
    logoPath = path.join(__dirname, 'logo.png');
    coverPath = path.join(__dirname, 'cover.png');

    // Load existing screenshots from disk
    const screenshotCount = 6;
    for (let i = 0; i < screenshotCount; i++) {
      screenshotPaths.push(path.join(__dirname, `screenshot${i + 1}.png`));
    }
  }

  // Open Playwright debugger
  await page.pause();

  const createProjectButton = page.getByRole('button', { name: 'Create Project' });
  if (await createProjectButton.isVisible()) {
    await page.getByPlaceholder('MyAwesomeProject').fill("test");
    await page.getByText('What category does your project belong to?').click();
    await page.getByText('Gaming').click();
    await page.getByPlaceholder('Pick an emoji').fill('🎮');
    await page.getByRole('checkbox').check();
    await createProjectButton.click();
  }
  await page.pause();
  const truncatedBriefDescription = briefDescription.slice(0, 279);
  await page.getByPlaceholder('Exchange onramp/offramp using').fill(truncatedBriefDescription);
  await page.getByPlaceholder('This project combines a state').fill(detailedDescription);
  await page.getByPlaceholder('This project uses the @').fill(detailedDescription)
  await page.getByPlaceholder('https://github.com/hackathon/').fill("https://github.com/henrikkv/hackathon-submit");
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await page.pause();


  // Upload logo and cover images
  await uploadImage(page, logoPath, 'logoId', true);
  await uploadImage(page, coverPath, 'bannerId', true);

  // Screenshot input IDs
  const screenshotIds = [
    'screenshot1',
    'screenshot2',
    'screenshot3',
    'screenshot4',
    'screenshot5',
    'screenshot6',
  ];

  // Upload screenshots
  for (let i = 0; i < screenshotPaths.length; i++) {
    await uploadImage(page, screenshotPaths[i], screenshotIds[i], true);
  }

  // Add a 3-minute pause
  await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000));

  await page.pause();
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await page.pause();

  await browser.close();
}

void main();

