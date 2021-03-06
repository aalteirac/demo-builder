#! /bin/bash
node prepdeploy.js
git add .
git commit -m "v1.6.0, issues with images"
git push
docker stop testemb 
docker rm testemb 
docker image rm alteirac/emb
docker build . -t alteirac/emb
docker run -p 80:3000 -d --name testemb alteirac/emb
docker push alteirac/emb
npm run dist
electron-builder --windows nsis:x64
