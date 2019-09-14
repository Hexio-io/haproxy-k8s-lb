# Deployment

```bash
# Apply manifests
kubectl apply -f ./serviceAccount.yml
kubectl apply -f ./clusterRole.yml
kubectl apply -f ./clusterRoleBinding.yml

# Get config
export TOKEN_SECRET="<name of the secret containing the service account token>"
export KUBE_SERVER_CA=$(kubectl get secret/${TOKEN_SECRET} -o jsonpath='{.data.ca\.crt}')
export KUBE_SERVICE_TOKEN=$(kubectl get secret/${TOKEN_SECRET} -o jsonpath='{.data.token}' | base64 --decode)
export KUBE_NAMESPACE=$(kubectl get secret/${TOKEN_SECRET} -o jsonpath='{.data.namespace}' | base64 --decode)
```