#! /bin/bash
git add .
git commit -m "v1.10, bug fixed: actions were broken in some specific circumstances"
git push
docker stop testemb 
docker rm testemb 
docker image rm alteirac/emb
docker build . -t alteirac/emb
docker run -p 80:3000 -d --name testemb alteirac/emb
docker push alteirac/emb

